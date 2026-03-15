import { findPairingByDeviceId, findPairingByToken, addNodeConnection, removeNodeConnection, addNodeToGracePeriod, removeNodeFromGracePeriod, addPendingPairing, findPendingByDeviceId, getNodeConnection, generateRequestId, } from './store.js';
import { resolveRpc, rejectAllPending, onStreamChunk } from './invoke.js';
import { addPendingExecApproval } from './exec-approval.js';
import { saveNodeApprovals } from './approvals-store.js';
import { broadcast } from '../ws.js';
const CONNECT_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 60_000;
const pongTimeouts = new Map();
const PROTOCOL_VERSION = '1';
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION]);
function parseConnectPayload(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const o = raw;
    const deviceId = String(o.deviceId ?? '').trim();
    const displayName = String(o.displayName ?? 'Node').trim();
    const platform = String(o.platform ?? 'unknown').trim();
    const token = o.token != null ? String(o.token) : undefined;
    const caps = Array.isArray(o.capabilities) ? o.capabilities.map((c) => String(c)) : [];
    const envTools = Array.isArray(o.envTools) ? o.envTools.map((t) => String(t)) : [];
    const tags = Array.isArray(o.tags) ? o.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    const protocolVersion = o.protocolVersion != null ? String(o.protocolVersion) : undefined;
    if (!deviceId)
        return null;
    return { deviceId, displayName, platform, token, capabilities: caps, envTools, tags, protocolVersion };
}
/** 校验 protocolVersion：未提供则放行（兼容旧节点），不兼容版本拒绝 */
function checkProtocolVersion(version) {
    if (!version)
        return { ok: true };
    if (SUPPORTED_VERSIONS.has(version))
        return { ok: true };
    return { ok: false, error: 'protocol_version_unsupported' };
}
export function handleNodeConnect(ws, _req) {
    let connectTimer = null;
    let nodeId = null;
    const cleanup = () => {
        if (connectTimer)
            clearTimeout(connectTimer);
        if (nodeId) {
            const pt = pongTimeouts.get(nodeId);
            if (pt) {
                clearTimeout(pt);
                pongTimeouts.delete(nodeId);
            }
            rejectAllPending(nodeId);
            const conn = getNodeConnection(nodeId);
            if (conn) {
                addNodeToGracePeriod(nodeId, conn.capabilities);
            }
            removeNodeConnection(nodeId);
            broadcast({ type: 'node', payload: { action: 'offline', nodeId } });
        }
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    connectTimer = setTimeout(() => {
        connectTimer = null;
        if (!nodeId) {
            try {
                ws.send(JSON.stringify({ type: 'connect_result', ok: false, error: 'connect_timeout' }));
                ws.close();
            }
            catch {
                /* ignore */
            }
        }
    }, CONNECT_TIMEOUT_MS);
    ws.on('message', (data) => {
        try {
            const raw = JSON.parse(data.toString());
            const type = String(raw.type ?? '');
            if (type === 'connect') {
                if (nodeId)
                    return; // 已连接，忽略重复 connect
                const payload = parseConnectPayload(raw.payload);
                if (!payload) {
                    ws.send(JSON.stringify({ type: 'connect_result', ok: false, error: 'invalid_connect_payload' }));
                    ws.close();
                    return;
                }
                const pvCheck = checkProtocolVersion(payload.protocolVersion);
                if (!pvCheck.ok) {
                    ws.send(JSON.stringify({ type: 'connect_result', ok: false, error: pvCheck.error }));
                    ws.close();
                    return;
                }
                if (connectTimer) {
                    clearTimeout(connectTimer);
                    connectTimer = null;
                }
                handleConnectFrame(ws, payload, (nid) => {
                    nodeId = nid;
                });
                return;
            }
            if (type === 'res') {
                const id = String(raw.id ?? '');
                const ok = Boolean(raw.ok);
                const payload = raw.payload;
                if (nodeId && id)
                    resolveRpc(nodeId, id, ok, payload);
                return;
            }
            if (type === 'res_stream_chunk' && nodeId) {
                const id = String(raw.id ?? '');
                if (id)
                    onStreamChunk(nodeId, id);
                return;
            }
            if (type === 'pong') {
                const conn = nodeId ? getNodeConnection(nodeId) : undefined;
                if (conn) {
                    conn.lastPongAt = Date.now();
                }
                if (nodeId) {
                    const pt = pongTimeouts.get(nodeId);
                    if (pt) {
                        clearTimeout(pt);
                        pongTimeouts.delete(nodeId);
                    }
                }
                return;
            }
            if (type === 'exec_approval_request' && nodeId) {
                const payload = raw.payload;
                const reqId = String(payload?.reqId ?? '').trim();
                const command = String(payload?.command ?? '');
                const params = payload?.params;
                const cwd = typeof params?.cwd === 'string' ? params.cwd : '';
                const conn = getNodeConnection(nodeId);
                if (reqId && conn) {
                    void (async () => {
                        // 会话级自动批准：用户通过渠道发送「自动执行模式」后，该会话免批
                        const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId : undefined;
                        if (sessionId) {
                            const { getSessionMeta } = await import('../session/store.js');
                            const meta = getSessionMeta(sessionId);
                            if (meta?.autoApprove) {
                                const { resolveExecApproval } = await import('./exec-approval.js');
                                resolveExecApproval(reqId, true);
                                return;
                            }
                        }
                        const { getNodeApprovals } = await import('./approvals-store.js');
                        const approvals = await getNodeApprovals(nodeId);
                        const trustPaths = approvals?.trustPaths ?? [];
                        const trustPatterns = approvals?.trustPatterns ?? [];
                        const fullCmd = `${cwd ? `cwd=${cwd} ` : ''}${command}`;
                        const autoApprove = trustPaths.some((p) => (cwd && cwd.includes(p)) || command.includes(p)) ||
                            trustPatterns.some((pat) => {
                                try {
                                    return new RegExp(pat).test(fullCmd);
                                }
                                catch {
                                    return false;
                                }
                            });
                        if (autoApprove) {
                            const { resolveExecApproval } = await import('./exec-approval.js');
                            resolveExecApproval(reqId, true);
                            return;
                        }
                        const timeoutMs = approvals?.approvalTimeoutMs ?? (Number(process.env.APEXPANDA_EXEC_APPROVAL_TIMEOUT_MS) || 30_000);
                        addPendingExecApproval(reqId, nodeId, conn.displayName, command, params, ws, async (p) => {
                            // 超时后按规则放行：若满足 trustPaths/trustPatterns 则批准
                            const { getNodeApprovals } = await import('./approvals-store.js');
                            const nodeApprovals = await getNodeApprovals(p.nodeId);
                            const tp = nodeApprovals?.trustPaths ?? [];
                            const tpat = nodeApprovals?.trustPatterns ?? [];
                            const cwdStr = typeof p.params?.cwd === 'string' ? p.params.cwd : '';
                            const fullCmd = `${cwdStr ? `cwd=${cwdStr} ` : ''}${p.command}`;
                            const trustMatch = tp.some((x) => (cwdStr && cwdStr.includes(x)) || p.command.includes(x)) ||
                                tpat.some((pat) => {
                                    try {
                                        return new RegExp(pat).test(fullCmd);
                                    }
                                    catch {
                                        return false;
                                    }
                                });
                            return trustMatch;
                        }, timeoutMs);
                        broadcast({
                            type: 'exec_approval_request',
                            payload: { reqId, nodeId, displayName: conn.displayName, command, params },
                        });
                    })();
                }
                return;
            }
            if (type === 'exec_approvals_report' && nodeId) {
                const payload = raw.payload;
                if (payload && typeof payload === 'object') {
                    saveNodeApprovals(nodeId, payload).catch((e) => console.error('[node] saveNodeApprovals error:', e));
                }
                return;
            }
            if (type === 'voice_audio_ready' && nodeId) {
                const payload = raw.payload;
                const base64 = payload?.base64 ?? '';
                const format = String(payload?.format ?? 'webm');
                if (base64) {
                    import('../channels/voice-handler.js').then(({ handleVoiceAudioReady }) => handleVoiceAudioReady(nodeId, base64, format)).catch((e) => console.error('[node] voice_audio_ready 处理失败:', e));
                }
                return;
            }
        }
        catch {
            /* ignore invalid json */
        }
    });
}
async function handleConnectFrame(ws, payload, onNodeId) {
    const { deviceId, displayName, platform, token, capabilities, envTools = [], tags = [] } = payload;
    if (token) {
        const pairing = await findPairingByToken(token);
        if (!pairing || pairing.deviceId !== deviceId) {
            ws.send(JSON.stringify({ type: 'connect_result', ok: false, error: 'token_invalid' }));
            ws.close();
            return;
        }
        const nodeId = pairing.nodeId;
        removeNodeFromGracePeriod(nodeId);
        const conn = {
            ws,
            nodeId,
            deviceId,
            displayName,
            platform,
            capabilities,
            envTools,
            tags,
            connectedAt: Date.now(),
            lastPongAt: Date.now(),
        };
        addNodeConnection(conn);
        onNodeId(nodeId);
        ws.send(JSON.stringify({ type: 'connect_result', ok: true, nodeId }));
        import('../voicewake/config.js').then(({ loadVoiceWakeConfig }) => loadVoiceWakeConfig()).then((config) => {
            if (config && ws.readyState === 1)
                ws.send(JSON.stringify({ type: 'voicewake_config', payload: config }));
        }).catch(() => { });
        broadcast({ type: 'node', payload: { action: 'online', nodeId, displayName, platform, capabilities, envTools, tags } });
        startPingLoop(ws, nodeId);
        return;
    }
    const existing = await findPairingByDeviceId(deviceId);
    if (existing) {
        ws.send(JSON.stringify({ type: 'connect_result', ok: false, error: 'already_paired_need_token' }));
        ws.close();
        return;
    }
    const existingPending = findPendingByDeviceId(deviceId);
    const requestId = existingPending ? existingPending.requestId : generateRequestId();
    if (existingPending) {
        existingPending.ws = ws;
        existingPending.displayName = displayName;
        existingPending.platform = platform;
        existingPending.requestedAt = Date.now();
    }
    else {
        addPendingPairing({
            requestId,
            deviceId,
            displayName,
            platform,
            requestedAt: Date.now(),
            ws,
        });
    }
    ws.send(JSON.stringify({ type: 'connect_result', ok: false, needPairing: true, requestId }));
    broadcast({ type: 'node', payload: { action: 'pairing', requestId, deviceId, displayName, platform } });
}
function startPingLoop(ws, nodeId) {
    const ping = () => {
        if (ws.readyState !== 1)
            return;
        try {
            ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
        catch {
            return;
        }
        const prev = pongTimeouts.get(nodeId);
        if (prev)
            clearTimeout(prev);
        const pt = setTimeout(() => {
            pongTimeouts.delete(nodeId);
            const conn = getNodeConnection(nodeId);
            if (conn && Date.now() - conn.lastPongAt > PONG_TIMEOUT_MS) {
                try {
                    ws.close();
                }
                catch {
                    /* ignore */
                }
            }
        }, PONG_TIMEOUT_MS);
        pongTimeouts.set(nodeId, pt);
    };
    const pingInterval = setInterval(ping, PING_INTERVAL_MS);
    ping();
    ws.on('close', () => {
        clearInterval(pingInterval);
        const pt = pongTimeouts.get(nodeId);
        if (pt) {
            clearTimeout(pt);
            pongTimeouts.delete(nodeId);
        }
    });
}
//# sourceMappingURL=ws-handler.js.map