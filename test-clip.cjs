const { app, clipboard } = require('electron');
app.whenReady().then(() => {
  const formats = clipboard.availableFormats();
  console.log("FORMATS:", formats);
  for (const f of formats) {
    try {
      let data = clipboard.read(f);
      console.log(`Format ${f}:`, data.substring(0, 100));
    } catch(e) {}
  }
  app.quit();
});
