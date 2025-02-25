/// <reference path="../../../typings/index.d.ts"/>
import { createClient, createResolver } from '@pnpm/client'

test('createClient()', () => {
  const client = createClient({
    authConfig: { registry: 'https://registry.npmjs.org/' },
    cacheDir: '',
  })
  expect(typeof client === 'object').toBeTruthy()
})

test('createResolver()', () => {
  const resolver = createResolver({
    authConfig: { registry: 'https://registry.npmjs.org/' },
    cacheDir: '',
  })
  expect(typeof resolver === 'function').toBeTruthy()
})
