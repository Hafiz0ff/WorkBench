export default function register(api) {
  api.on('pre-prompt', async (ctx) => {
    const extra = await api.code.readFile('context.md');
    return {
      ...ctx,
      messages: [
        { role: 'system', content: extra },
        ...ctx.messages,
      ],
    };
  });
}
