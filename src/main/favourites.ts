import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseChannelInput } from '@shared/channel'

/**
 * The user's own list, so it lives with their data rather than in renderer
 * storage — clearing the window's site data should not lose it, and it is the
 * one piece of state here that would be genuinely annoying to rebuild.
 */
let userDataDir = ''
let cache: string[] | null = null

export function setFavouritesDir(dir: string): void {
  userDataDir = dir
}

const filePath = (): string => join(userDataDir, 'favourites.json')

export async function listFavourites(): Promise<string[]> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf8')) as unknown
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    cache = []
  }
  return cache
}

async function save(next: string[]): Promise<string[]> {
  cache = next
  try {
    await mkdir(dirname(filePath()), { recursive: true })
    await writeFile(filePath(), JSON.stringify(next, null, 2))
  } catch {
    // Keep the in-memory list; the next write may succeed.
  }
  return next
}

export async function addFavourite(raw: string): Promise<string[]> {
  const login = parseChannelInput(raw)
  if (!login) return listFavourites()
  const current = await listFavourites()
  if (current.includes(login)) return current
  return save([...current, login])
}

export async function removeFavourite(raw: string): Promise<string[]> {
  const login = parseChannelInput(raw)
  if (!login) return listFavourites()
  return save((await listFavourites()).filter((c) => c !== login))
}
