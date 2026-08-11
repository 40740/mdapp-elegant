import { createEditor, getMarkdown, setMarkdown, showMathModal } from './editor/editor'
import { SearchPanel } from './editor/search-panel'
import { applyTheme, loadSavedTheme } from './themes/theme-manager'
import './themes/base.css'

function isSlidesContent(content: string): boolean {
  return /^---\s*\n[\s\S]*?(kicker|chip):/m.test(content)
}

let sourceModeActive = false
// Markdown as it was when source mode was entered, to detect edits on exit
let sourceModeOriginal = ''
const editorEl = () => document.getElementById('editor') as HTMLElement
const sourceEl = () => document.getElementById('source-editor') as HTMLTextAreaElement
const slidesBtnEl = () => document.getElementById('slides-btn') as HTMLButtonElement
const filePanelEl = () => document.getElementById('file-panel') as HTMLElement
const fileListEl = () => document.getElementById('file-list') as HTMLElement
const fileToggleBtnEl = () => document.getElementById('file-toggle-btn') as HTMLButtonElement

// --- Same-directory file panel ---
let currentFilePath: string | null = null
let dirty = false
// Milkdown's markdownUpdated listener fires 200ms-debounced AFTER a doc change,
// so a programmatic load would spuriously mark the doc dirty unless we keep a
// suppression window long enough to cover that debounce.
let applyingUntil = 0
let manualHidden = localStorage.getItem('file-panel-hidden') === '1'

function markApplying(): void {
  applyingUntil = Date.now() + 350
}

function applyContent(content: string): void {
  markApplying()
  setContent(content)
}

function updatePanelVisibility(): void {
  const show = currentFilePath !== null && !manualHidden
  filePanelEl().hidden = !show
  document.body.classList.toggle('show-file-panel', show)
  fileToggleBtnEl().classList.toggle('active', show)
}

function togglePanel(): void {
  manualHidden = !manualHidden
  localStorage.setItem('file-panel-hidden', manualHidden ? '1' : '0')
  updatePanelVisibility()
}

function renderFileList(files: import('../preload/index').SiblingFile[]): void {
  const list = fileListEl()
  list.innerHTML = ''
  for (const f of files) {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.textContent = f.name
    btn.title = f.name
    btn.dataset.path = f.path
    if (f.path === currentFilePath) btn.classList.add('active')
    li.appendChild(btn)
    list.appendChild(li)
  }
}

async function refreshSiblings(): Promise<void> {
  const files = await window.electronAPI.listSiblings()
  if (files) renderFileList(files)
}

function enterSourceMode(content: string): void {
  sourceModeActive = true
  sourceModeOriginal = content
  editorEl().classList.add('hidden')
  const ta = sourceEl()
  ta.classList.add('visible')
  ta.value = content
  slidesBtnEl().classList.add('visible')
}

function exitSourceMode(): void {
  sourceModeActive = false
  editorEl().classList.remove('hidden')
  sourceEl().classList.remove('visible')
  slidesBtnEl().classList.remove('visible')
}

// ⌘/Ctrl+/ — switch between WYSIWYG and raw Markdown (see/delete ##, == markers)
function toggleSourceMode(): void {
  if (sourceModeActive) {
    const raw = sourceEl().value
    exitSourceMode()
    if (raw !== sourceModeOriginal) dirty = true
    markApplying()
    setMarkdown(raw)
  } else {
    enterSourceMode(getMarkdown())
  }
}

function setContent(content: string): void {
  if (isSlidesContent(content)) {
    enterSourceMode(content)
  } else {
    exitSourceMode()
    setMarkdown(content)
  }
}

function getContent(): string {
  if (sourceModeActive) return sourceEl().value
  return getMarkdown()
}

async function init(): Promise<void> {
  const api = window.electronAPI
  const savedTheme = loadSavedTheme()
  applyTheme(savedTheme)

  if (savedTheme.startsWith('custom:')) {
    const fileName = savedTheme.slice(7)
    const css = await api.loadThemeCSS(fileName)
    if (css) applyTheme(savedTheme, css)
  }

  const searchPanel = new SearchPanel()
  api.onSearch(() => searchPanel.show())
  api.onMathModal(() => showMathModal())

  await createEditor('editor', () => {
    if (Date.now() >= applyingUntil) dirty = true
  })

  // File panel: switch to a sibling file (confirm if there are unsaved edits)
  fileListEl().addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-path]') as HTMLButtonElement | null
    if (!btn || !btn.dataset.path) return
    if (btn.dataset.path === currentFilePath) return
    if (dirty && !window.confirm('当前文件有未保存的修改，切换文件会丢失这些修改。是否继续？')) return
    await api.openSibling(btn.dataset.path)
  })

  fileToggleBtnEl().addEventListener('click', togglePanel)
  api.onToggleFilePanel(() => togglePanel())
  api.onToggleSourceMode(() => toggleSourceMode())

  api.onSiblingsChanged((files) => renderFileList(files))
  updatePanelVisibility()

  // Slides button — open as slides
  slidesBtnEl().addEventListener('click', () => api.openAsSlides(getContent()))

  api.onMenuOpen(async () => {
    // 'file-opened' event drives the content load (and file-panel refresh)
    await api.openFile()
  })

  api.onMenuSave(async () => {
    const ok = await api.saveFile(getContent())
    if (ok) dirty = false
  })
  api.onMenuSaveAs(async () => {
    const ok = await api.saveFileAs(getContent())
    if (ok) dirty = false
  })
  api.onMenuExportPDF(() => api.exportPDF())

  api.onNewFile(() => { exitSourceMode(); applyContent('') })
  api.onFileOpened((data) => {
    currentFilePath = data.path
    dirty = false
    markApplying()
    setContent(data.content)
    updatePanelVisibility()
    refreshSiblings()
  })
  api.onFileChanged((content) => {
    markApplying()
    if (sourceModeActive) {
      sourceEl().value = content
    } else {
      setMarkdown(content)
    }
    dirty = false
  })
  api.onSetTheme((theme) => applyTheme(theme))
  api.onSetCustomCSS((css) => {
    const theme = loadSavedTheme()
    applyTheme(theme, css)
  })

  api.onMenuNewSlides(async () => {
    await api.newSlides()
  })

  api.onNewSlidesContent((content) => {
    enterSourceMode(content)
  })

  api.onMenuOpenAsSlides(async () => {
    await api.openAsSlides(getContent())
  })

  api.onMenuExportSlides(async () => {
    await api.exportSlides(getContent())
  })

  api.onMenuImportTheme(async () => {
    const result = await api.loadCustomTheme()
    if (result) applyTheme(`custom:${result.name}`, result.css)
  })

  const agentDot = document.getElementById('agent-dot')
  api.onAgentActivity((state) => {
    if (agentDot) agentDot.className = state === 'idle' ? '' : state
  })

  document.addEventListener('dragover', (e) => e.preventDefault())
  document.addEventListener('drop', async (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    if (!file) return
    const filePath = api.getPathForFile(file)
    if (!filePath) return
    const result = await api.openFilePath(filePath)
    // 'file-opened' event drives the content load when opened into this window
    void result
  })
}

init().catch((e) => console.error('ColaMD init failed:', e))
