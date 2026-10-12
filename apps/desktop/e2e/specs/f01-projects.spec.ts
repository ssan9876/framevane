import { rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../fixtures'

/** S01 project management edges (part of F01). */
test.describe('F01 project management', () => {
  async function makeProject(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /New project/ }).click()
    await page.getByRole('tab', { name: 'Media' }).waitFor()
    await page.getByRole('button', { name: 'Projects' }).click()
    await page.getByRole('heading', { name: 'Start something' }).waitFor()
  }

  test('F01-E7 a 200-character name with emoji is saved', async ({ reel }) => {
    const { page } = reel
    await makeProject(page)
    const long = `Café 🎬 ${'Very long project name '.repeat(9)}`.slice(0, 200)
    await page.getByRole('button', { name: /^More actions for / }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill(long)
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: `Open ${long}` })).toBeVisible()
    await expect(page.getByText(long, { exact: true })).toHaveAttribute('title', long)
  })

  test('F01-E8 an empty name is refused', async ({ reel }) => {
    const { page } = reel
    await makeProject(page)
    await page.getByRole('button', { name: /^More actions for / }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'Name' }).fill('   ')
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
    await expect(page.getByText('Give the project a name.')).toBeVisible()
  })

  test('duplicate and delete', async ({ reel }) => {
    const { page } = reel
    await makeProject(page)
    await page.getByRole('button', { name: /^More actions for / }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(2)
    await page.getByRole('button', { name: /^More actions for .* copy$/ }).click({ force: true })
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete project' }).click()
    await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1)
  })

  test('F01-N3 a project whose folder was deleted shows as missing and can be removed', async ({ reel }) => {
    const page = reel.page
    await makeProject(page)
    const projectsDir = join(reel.root, 'projects')
    for (const d of readdirSync(projectsDir)) rmSync(join(projectsDir, d), { recursive: true, force: true })
    const fresh = await reel.relaunch()
    await expect(fresh.getByText('Folder missing').first()).toBeVisible()
    const broken = fresh.getByRole('button', { name: /^Open Project/ }).first()
    await expect(broken).toBeDisabled()
  })

  test('search filters projects', async ({ reel }) => {
    const { page } = reel
    await makeProject(page)
    await page.getByRole('textbox', { name: 'Search projects' }).fill('zzz-no-match')
    await expect(page.getByText(/No projects match/)).toBeVisible()
    await page.getByRole('textbox', { name: 'Search projects' }).fill('')
    await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1)
  })
})
