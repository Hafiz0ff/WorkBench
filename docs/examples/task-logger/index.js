export default function register(api) {
  api.on('post-task', async (ctx) => {
    await api.notes.append('task-log.md', `- ${ctx.taskId}: ${ctx.result}`);
    return ctx;
  });
}
