export const me = { id: 'riley', name: 'Riley Chen' };
export function comment(id, screen = 'home', extra = {}) {
  return { id, screen: '/' + screen, screenTitle: screen[0].toUpperCase() + screen.slice(1), hash: '#/' + screen,
    version: 2, pin: null, text: 'Feedback on ' + screen, author: me.id, createdAt: '2026-10-26T10:00:00.000Z',
    updatedAt: '2026-10-26T10:00:00.000Z', status: 'open', resolvedIn: null, ...extra };
}
export const screenshotConfig = {
  me, canWrite: true, people: { jordan: { name: 'Jordan Park' }, riley: { name: 'Riley Chen' } },
  seed: {
    comments: [
      comment('welcome-pin', 'home', { author: 'jordan', pin: { x: .42, y: 255 }, text: 'Could the welcome explain what happens next?' }),
      comment('landmark-pin', 'home', { author: 'riley', pin: { x: .64, y: 580 }, text: 'This is a useful place for a little more context.', createdAt: '2026-10-26T10:04:00.000Z' }),
      comment('list-note', 'list', { text: 'Can we make the first item easier to find?' }),
      comment('detail-note', 'detail', { author: 'riley', text: 'The detail screen feels clear.' }),
      comment('fixed-home', 'home', { status: 'done', resolvedIn: 2, version: 1, text: 'Try a calmer welcome colour.' })
    ],
    replies: [{ id: 'claude-reply', commentId: 'welcome-pin', author: 'riley', by: 'claude',
      text: 'I clarified the welcome in v2. Let me know how it feels.', createdAt: '2026-10-26T10:06:00.000Z', version: 2 }]
  }
};
