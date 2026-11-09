import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { DialogUnavailableError, dialogCommands, pickOpenPath, pickPath, pickSavePath } from '../lib/core/pick-path.mjs'

test('dialogCommands: Windows uses PowerShell Save/OpenFileDialog', () => {
  const save = dialogCommands({ platform: 'win32', mode: 'save', defaultPath: 'C:/Users/me/Downloads/dsh-fatfish-x.zip' })
  assert.equal(save.length, 1)
  assert.equal(save[0].command, 'powershell')
  assert.ok(save[0].args.join(' ').includes('SaveFileDialog'))
  assert.ok(save[0].args.join(' ').includes('dsh-fatfish-x.zip'))

  const open = dialogCommands({ platform: 'win32', mode: 'open' })
  assert.ok(open[0].args.join(' ').includes('OpenFileDialog'))
})

test('dialogCommands: macOS uses osascript choose file name / choose file', () => {
  const save = dialogCommands({ platform: 'darwin', mode: 'save', defaultPath: 'dsh-fatfish-x.zip' })
  assert.equal(save[0].command, 'osascript')
  assert.match(save[0].args[1], /choose file name/)
  const open = dialogCommands({ platform: 'darwin', mode: 'open' })
  assert.match(open[0].args[1], /choose file with prompt/)
})

test('dialogCommands: Windows save dialog keeps the CJK file name and drive directory (#18)', () => {
  const [candidate] = dialogCommands({
    platform: 'win32',
    mode: 'save',
    defaultPath: String.raw`C:\Users\me\下载\dsh-fatfish-2026.zip`,
  })
  const script = candidate.args.join(' ')
  assert.ok(script.includes(String.raw`$dialog.FileName = 'dsh-fatfish-2026.zip'`), 'only the file name, not the whole path')
  assert.ok(script.includes(String.raw`$dialog.InitialDirectory = 'C:\Users\me\下载'`), 'the drive-letter directory must be kept')
  assert.ok(candidate.args.includes('-STA'), 'WinForms dialogs need a single-threaded apartment')
})

test('dialogCommands: Linux needs a display, then zenity before kdialog', () => {
  assert.deepEqual(dialogCommands({ platform: 'linux', env: {} }), [], 'headless must not try a GUI dialog')
  const withDisplay = dialogCommands({ platform: 'linux', env: { DISPLAY: ':0' }, mode: 'save', defaultPath: '/tmp/x.zip' })
  assert.deepEqual(withDisplay.map((item) => item.id), ['zenity', 'kdialog'])
  assert.ok(withDisplay[0].args.includes('--save'))
  const wayland = dialogCommands({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, mode: 'open' })
  assert.equal(wayland[0].id, 'zenity')
})

test('pickPath: returns the chosen path and trims CRLF from PowerShell output', async () => {
  const chosen = await pickPath({
    platform: 'win32',
    defaultPath: 'x.zip',
    runner: async () => ({ stdout: 'D:\\backup\\dsh-fatfish.zip\r\n' }),
  })
  assert.equal(chosen, 'D:\\backup\\dsh-fatfish.zip')
})

test('pickPath: empty output means the user cancelled', async () => {
  const chosen = await pickPath({ platform: 'darwin', runner: async () => ({ stdout: '\n' }) })
  assert.equal(chosen, null)
})

test('pickPath: a non-zero exit with cancel means cancelled', async () => {
  const chosen = await pickPath({
    platform: 'linux',
    env: { DISPLAY: ':0' },
    runner: async () => { const error = new Error('cancelled'); error.code = 1; throw error },
  })
  assert.equal(chosen, null)
})

test('pickPath: falls through missing tools, then reports unavailable', async () => {
  const tried = []
  const chosen = await pickPath({
    platform: 'linux',
    env: { DISPLAY: ':0' },
    runner: async (command) => {
      tried.push(command)
      if (command === 'zenity') { const error = new Error('not found'); error.code = 'ENOENT'; throw error }
      return { stdout: '/home/me/out.zip' }
    },
  })
  assert.deepEqual(tried, ['zenity', 'kdialog'])
  assert.equal(chosen, '/home/me/out.zip')

  await assert.rejects(
    () => pickPath({
      platform: 'linux',
      env: { DISPLAY: ':0' },
      runner: async () => { const error = new Error('not found'); error.code = 'ENOENT'; throw error },
    }),
    (error) => error instanceof DialogUnavailableError
      && error.code === 'DIALOG_UNAVAILABLE'
      && error.tried.join(',') === 'zenity,kdialog',
  )
})

test('pickPath: a broken GUI tool falls through to the next candidate (#20)', async () => {
  const tried = []
  const chosen = await pickPath({
    platform: 'linux',
    env: { DISPLAY: ':0' },
    runner: async (command) => {
      tried.push(command)
      if (command === 'zenity') {
        const error = new Error('Gtk-WARNING: cannot open display')
        error.code = 2
        error.stderr = 'Gtk-WARNING: cannot open display'
        throw error
      }
      return { stdout: '/home/me/out.zip\n' }
    },
  })
  assert.deepEqual(tried, ['zenity', 'kdialog'], 'a non-ENOENT zenity failure must still try kdialog')
  assert.equal(chosen, '/home/me/out.zip')
})

test('pickPath: headless environments raise DialogUnavailableError immediately', async () => {
  await assert.rejects(() => pickPath({ platform: 'linux', env: {} }), /没有可用的图形对话框/)
})

test('pickPath: the real Linux host only offers dialogs when a display exists (#20)', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux-only environment probe')
  const env = { ...process.env }
  const candidates = dialogCommands({ mode: 'save', platform: 'linux', env })
  if (env.DISPLAY || env.WAYLAND_DISPLAY) {
    assert.equal(candidates[0]?.id, 'zenity', 'a display must offer zenity first')
    return
  }
  // CI ubuntu-latest is headless: the fallback must be reported before any spawn.
  assert.deepEqual(candidates, [], 'no DISPLAY / WAYLAND_DISPLAY means no GUI candidates')
  const spawned = []
  await assert.rejects(
    () => pickPath({ platform: 'linux', env, runner: async (command) => { spawned.push(command); return { stdout: '/tmp/x.zip' } } }),
    (error) => error?.code === 'DIALOG_UNAVAILABLE' && error.tried.length === 0,
  )
  assert.deepEqual(spawned, [], 'headless must not spawn zenity/kdialog at all')
})

test('pickPath: the GUI probe gets a timeout and no console window', async () => {
  const seen = []
  await pickPath({
    platform: 'win32',
    defaultPath: String.raw`C:\Users\me\Downloads\dsh-fatfish-2026.zip`,
    timeoutMs: 1234,
    runner: async (command, args, options) => { seen.push({ command, options }); return { stdout: '' } },
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].command, 'powershell')
  assert.equal(seen[0].options.timeout, 1234, 'the dialog probe must be bounded in time')
  assert.equal(seen[0].options.windowsHide, true, 'a hidden console window must be requested')
})

test('pickSavePath / pickOpenPath set the mode', async () => {
  const saveArgs = []
  await pickSavePath({ platform: 'darwin', runner: async (command, args) => { saveArgs.push(args[1]); return { stdout: '/tmp/a.zip' } } })
  assert.match(saveArgs[0], /choose file name/)
  const openArgs = []
  await pickOpenPath({ platform: 'darwin', runner: async (command, args) => { openArgs.push(args[1]); return { stdout: '/tmp/a.zip' } } })
  assert.match(openArgs[0], /choose file with prompt/)
})
