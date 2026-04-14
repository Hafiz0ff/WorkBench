export default function register(api) {
  api.on('pre-patch', async (ctx) => {
    api.log('formatting patch', ctx.patch?.filePath || '');
    return ctx;
  });
}
