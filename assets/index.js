import e from "electron";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const {app,BrowserWindow,Menu} = e;

function createWindow () {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: "Karaoo",
    icon: path.join(__dirname, 'images/karaoke.png'),
    webPreferences: {
      nodeIntegration: true
    }
  });

  // 1. Remove o menu nativo da aplicação
  Menu.setApplicationMenu(null);

  win.loadFile('assets/components/index.html')
    win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})