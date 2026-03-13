export function createSessionId(channel, channelPeerId, tenantId) {
    return `session:${tenantId}:${channel}:${channelPeerId}`;
}
export function parseSessionId(sessionId) {
    const match = sessionId.match(/^session:([^:]+):([^:]+):(.+)$/);
    if (!match)
        return null;
    return {
        tenantId: match[1],
        channel: match[2],
        channelPeerId: match[3],
    };
}
//# sourceMappingURL=session.js.map