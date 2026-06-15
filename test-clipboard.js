const { app, clipboard } = require('electron');
app.whenReady().then(() => {
  console.log("public.file-url:", clipboard.read('public.file-url'));
  console.log("NSFilenamesPboardType:", clipboard.read('NSFilenamesPboardType'));
  app.quit();
});
