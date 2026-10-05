import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { isDev } from './dev-mode'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

/** Natives App-Menü mit Noctua-Aktionen für Dev- und Release-Bundle. */
export function installAppMenu(push: PushFn, getWindow: () => BrowserWindow | null): void {
  app.setAboutPanelOptions({
    applicationName: 'Noctua',
    applicationVersion: app.getVersion(),
    copyright: 'AI-first Mail-Client · Tim Sigl',
    credits:
      'Triage, Drafts und Postfach-Chat laufen über OpenRouter;\nEmbeddings lokal auf diesem Mac.'
  })

  const send = (action: PushPayload<'app:menuAction'>['action']): void => {
    const win = getWindow()
    if (win) {
      win.show()
      win.focus()
    }
    push('app:menuAction', { action })
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Noctua',
      submenu: [
        { label: 'Über Noctua', role: 'about' },
        { type: 'separator' },
        {
          label: 'Einstellungen…',
          accelerator: 'Cmd+,',
          click: () => send('settings')
        },
        { type: 'separator' },
        { role: 'services', label: 'Dienste' },
        { type: 'separator' },
        { role: 'hide', label: 'Noctua ausblenden' },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: 'Noctua beenden' }
      ]
    },
    {
      label: 'Ablage',
      submenu: [
        {
          label: 'Neue E-Mail',
          accelerator: 'Cmd+N',
          click: () => send('compose')
        },
        {
          label: 'Suchen',
          accelerator: 'Cmd+F',
          click: () => send('search')
        },
        { type: 'separator' },
        {
          label: 'Konto hinzufügen…',
          click: () => send('addAccount')
        },
        { type: 'separator' },
        { role: 'close', label: 'Fenster schließen' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einsetzen' },
        { role: 'selectAll', label: 'Alles auswählen' }
      ]
    },
    {
      label: 'Darstellung',
      submenu: [
        { label: 'Posteingang', accelerator: 'Cmd+1', click: () => send('inbox') },
        { label: 'Wartet auf Antwort', accelerator: 'Cmd+2', click: () => send('waiting') },
        { label: 'Aufgaben', accelerator: 'Cmd+3', click: () => send('tasks') },
        { type: 'separator' },
        // Bewusst ohne Accelerator: ⌘5 ist abgeschafft, / und ⌘F führen zur Suche
        { label: 'Suchen & die Eule fragen', click: () => send('chat') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild ein/aus' },
        ...(isDev
          ? ([
              { type: 'separator' },
              { role: 'reload', label: 'Neu laden (Dev)' },
              { role: 'toggleDevTools', label: 'DevTools (Dev)' }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: 'Fenster',
      role: 'windowMenu',
      submenu: [
        { role: 'minimize', label: 'Im Dock ablegen' },
        { role: 'zoom', label: 'Zoomen' },
        { type: 'separator' },
        { role: 'front', label: 'Alle nach vorne bringen' }
      ]
    },
    {
      label: 'Hilfe',
      submenu: [
        {
          label: 'Tastaturkürzel',
          accelerator: 'Cmd+/',
          click: () => send('shortcuts')
        },
        {
          label: 'Noctua auf GitHub',
          click: () => void shell.openExternal('https://github.com/Schereo/noctua')
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
