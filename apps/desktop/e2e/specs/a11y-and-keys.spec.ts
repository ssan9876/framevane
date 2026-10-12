import { a11y, clips, expect, newProjectFromFiles, test, timeline } from '../fixtures'
import { files } from '../global-setup'

/** X-A11Y axe on every built screen · X-KB transport keys · F05 partial (music) · S21 stub. */
test.describe('accessibility and keyboard', () => {
  test.use({ pickFiles: [files.talk, files.music], reelEnv: { FRAMEVANE_FAKE_AGENT: '1' } })

  test('X-A11Y axe WCAG 2.2 AA on every built screen', async ({ framevane }) => {
    const { page } = framevane
    const all: Awaited<ReturnType<typeof a11y>> = []
    all.push(...(await a11y(page, 'S01 empty')))
    await newProjectFromFiles(page)
    await expect(clips(page)).toHaveCount(1)
    all.push(...(await a11y(page, 'S03 editor')))
    await page.getByRole('tab', { name: 'Captions' }).click()
    all.push(...(await a11y(page, 'S11 captions')))
    await page.getByRole('button', { name: 'Modify canvas…' }).click()
    all.push(...(await a11y(page, 'S02 project settings')))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    all.push(...(await a11y(page, 'S22 export')))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Settings' }).first().click()
    all.push(...(await a11y(page, 'S23 settings')))
    await page.getByRole('tab', { name: 'Agents & AI' }).click()
    all.push(...(await a11y(page, 'S28 agents')))
    await page.getByRole('tab', { name: 'Shortcuts' }).click()
    all.push(...(await a11y(page, 'S24 shortcuts')))
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Cut the silences and add captions' }).click()
    await page.getByRole('button', { name: 'Review edits' }).click({ timeout: 180_000 })
    all.push(...(await a11y(page, 'S29 review')))
    await page.keyboard.press('Escape')
    await clips(page).first().click()
    all.push(...(await a11y(page, 'S14 clip inspector')))
    await page.getByRole('button', { name: 'Projects' }).click()
    all.push(...(await a11y(page, 'S01 filled')))
    test.info().attachments.push({ name: 'axe-violations.json', contentType: 'application/json', body: Buffer.from(JSON.stringify(all, null, 2)) })
    console.log(JSON.stringify(all, null, 1))
    expect(all).toEqual([])
  })

  test('X-KB Space, arrows, Home/End move the playhead', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    const tc = page.getByRole('img', { name: /^Preview at / })
    await timeline(page).click({ position: { x: 160, y: 10 } })
    await page.keyboard.press('Home')
    await expect(tc).toHaveAttribute('aria-label', 'Preview at 00:00:00:00')
    await page.keyboard.press('ArrowRight')
    await expect(tc).toHaveAttribute('aria-label', 'Preview at 00:00:00:01')
    await page.keyboard.press('Shift+ArrowRight')
    await expect(tc).toHaveAttribute('aria-label', 'Preview at 00:00:01:01')
    await page.keyboard.press('End')
    await expect(tc).toHaveAttribute('aria-label', /Preview at 00:00:29:0[34]/)
    await page.keyboard.press('Home')
    await page.keyboard.press('Space')
    await page.waitForTimeout(1200)
    await page.keyboard.press('Space')
    const label = await tc.getAttribute('aria-label')
    expect(label).not.toBe('Preview at 00:00:00:00')
  })

  test('F05-H1 + E1 music on its own track, quieter after −20 dB', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await page.getByRole('tab', { name: 'Audio' }).click()
    await page.getByRole('button', { name: 'Add music.m4a at the playhead' }).click()
    await expect(page.getByRole('rowheader', { name: /Audio 1/ })).toBeVisible()
    await expect(clips(page)).toHaveCount(2)
    await clips(page).last().click()
    await page.getByRole('spinbutton', { name: 'Volume' }).fill('-20')
    await page.getByRole('spinbutton', { name: 'Volume' }).press('Enter')
    await expect(page.getByRole('button', { name: 'Reset Volume' })).toBeVisible()
  })

  test('S21 stub: Alt+K explains the keyframe graph is coming', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await timeline(page).click({ position: { x: 160, y: 10 } })
    await page.keyboard.press('Alt+k')
    await expect(page.getByText(/keyframe graph \(S21\) arrives in M1/).first()).toBeVisible()
  })
})
