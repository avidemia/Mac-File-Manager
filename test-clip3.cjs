const { app, clipboard } = require('electron');
const { execSync } = require('child_process');
app.whenReady().then(() => {
  // copy a file to clipboard using AppleScript
  execSync(`osascript -e 'set the clipboard to POSIX file "/Users/kam/Desktop/Books/Calculus-I/Calculus1.tex"'`);
  
  const nsFilenames = clipboard.read('NSFilenamesPboardType');
  console.log("nsFilenames:", nsFilenames.substring(0, 100));
  
  const fileUrl = clipboard.read('public.file-url');
  console.log("fileUrl:", fileUrl.substring(0, 100));

  app.quit();
});
