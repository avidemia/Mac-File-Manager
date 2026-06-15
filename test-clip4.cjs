const { app, clipboard } = require('electron');
const { execSync } = require('child_process');
app.whenReady().then(() => {
  execSync(`osascript -e 'set the clipboard to POSIX file "/Users/kam/Desktop/Books/Calculus-I/Calculus1.tex"'`);
  
  const nsFilenames = clipboard.read('NSFilenamesPboardType');
  if (nsFilenames) {
    const matches = [...nsFilenames.matchAll(/<string>(.*?)<\/string>/g)];
    const paths = matches.map(m => m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
    );
    console.log("Parsed paths:", paths);
  }
  
  app.quit();
});
