import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { parseOrgConfig, type OrgConfig } from './src/shared/org-config'

// Org-Konfiguration (Company Edition, docs/ORG-CONFIG.md): Pfad aus
// NOCTUA_ORG_CONFIG, sonst build/org-config.json, sonst keine. Ungültig =
// Build-Abbruch. Wird in den Main-Bundle eingebettet, zur Laufzeit nie gelesen.
function loadOrgConfig(): OrgConfig | null {
  const fromEnv = process.env.NOCTUA_ORG_CONFIG?.trim()
  const file = fromEnv ? resolve(fromEnv) : resolve('build/org-config.json')
  if (!existsSync(file)) {
    if (fromEnv) throw new Error(`NOCTUA_ORG_CONFIG zeigt auf eine fehlende Datei: ${file}`)
    return null
  }
  try {
    return parseOrgConfig(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const orgConfig = loadOrgConfig()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __NOCTUA_ORG_CONFIG__: JSON.stringify(orgConfig)
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main')
      }
    }
  },
  preload: {
    // zod wird mit ins Preload-Bundle gepackt (sandbox-kompatibel), daher kein externalize
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    // Vorwärmen verhindert Vites Mid-Session-Re-Optimize (führt sonst beim
    // allerersten Start zu doppelten React-Instanzen und Hook-Fehlern).
    optimizeDeps: {
      include: [
        'react',
        'react-dom/client',
        'zustand',
        '@tanstack/react-query',
        '@tanstack/react-virtual',
        'cmdk',
        'tinykeys',
        'dompurify',
        'zod'
      ]
    },
    plugins: [react(), tailwindcss()]
  }
})
