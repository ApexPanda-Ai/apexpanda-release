export const shortlinkStore = new Map();
const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function generateShortCode() {
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return shortlinkStore.has(code) ? generateShortCode() : code;
}
//# sourceMappingURL=store.js.map