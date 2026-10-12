import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { isDev } from './dev-mode'
import { getOrgConfig, helpLinks, productName } from './org-config'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

/** Natives App-Menü mit Noctua-Aktionen für Dev- und Release-Bundle. */
export function installAppMenu(push: PushFn, getWindow: () => BrowserWindow | null): void {
  const name = productName()
  const links = helpLinks()
  app.setAboutPanelOptions({
    applicationName: name,
    applicationVersion: app.getVersion(),
    copyright: 'E-Mail-Client mit KI · Tim Sigl',
    credits: getOrgConfig()
      ? 'Vorsortierung, Entwürfe und E-Mail-Chat laufen über die eingerichteten KI-Anbieter;\nSuchmodell lokal auf diesem Mac.'
      : 'Vorsortierung, Entwürfe und E-Mail-Chat laufen über OpenRouter;\nSuchmodell lokal auf diesem Mac.'
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
      label: name,
      submenu: [
        { label: `Über ${name}`, role: 'about' },
        { type: 'separator' },
        {
          label: 'Einstellungen…',
          accelerator: 'Cmd+,',
          click: () => send('settings')
        },
        { type: 'separator' },
        { role: 'services', label: 'Dienste' },
        { type: 'separator' },
        { role: 'hide', label: `${name} ausblenden` },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: `${name} beenden` }
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
        { label: 'Ausstehend', accelerator: 'Cmd+2', click: () => send('waiting') },
        { label: 'Aufgaben', accelerator: 'Cmd+3', click: () => send('tasks') },
        { label: 'Kalender', accelerator: 'Cmd+4', click: () => send('calendar') },
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
          label: links.homepageIsUpstream ? 'Noctua auf GitHub' : `${name}-Startseite`,
          click: () => void shell.openExternal(links.homepage)
        },
        ...(links.support
          ? ([
              {
                label: 'Support',
                click: () => void shell.openExternal(links.support!)
              }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
