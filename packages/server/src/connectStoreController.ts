import { fetch } from '@pnpm/fetch'
import {
  FetchPackageToStoreOptions,
  PackageFilesResponse,
  PackageResponse,
  RequestPackageOptions,
  StoreController,
  WantedDependency,
} from '@pnpm/store-controller-types'
import { DependencyManifest } from '@pnpm/types'

import pLimit from 'p-limit'
import pShare from 'promise-share'
import { v4 as uuidv4 } from 'uuid'

export type StoreServerController = StoreController & {
  stop: () => Promise<void>
}

export async function connectStoreController (
  initOpts: {
    remotePrefix: string
    concurrency?: number
  }
): Promise<StoreServerController> {
  const remotePrefix = initOpts.remotePrefix
  const limitedFetch = limitFetch.bind(null, pLimit(initOpts.concurrency ?? 100))

  return new Promise((resolve, reject) => {
    resolve({
      close: async () => { },
      fetchPackage: fetchPackage.bind(null, remotePrefix, limitedFetch),
      importPackage: async (to: string, opts: {
        filesResponse: PackageFilesResponse
        force: boolean
      }) => {
        return limitedFetch(`${remotePrefix}/importPackage`, {
          opts,
          to,
        }) as Promise<{ importMethod: string | undefined, isBuilt: boolean }>
      },
      prune: async () => {
        await limitedFetch(`${remotePrefix}/prune`, {})
      },
      requestPackage: requestPackage.bind(null, remotePrefix, limitedFetch),
      stop: async () => {
        await limitedFetch(`${remotePrefix}/stop`, {})
      },
      upload: async (builtPkgLocation: string, opts: { filesIndexFile: string, sideEffectsCacheKey: string }) => {
        await limitedFetch(`${remotePrefix}/upload`, {
          builtPkgLocation,
          opts,
        })
      },
    })
  })
}

function limitFetch<T>(limit: (fn: () => PromiseLike<T>) => Promise<T>, url: string, body: object): Promise<T> { // eslint-disable-line
  return limit(async () => {
    // TODO: the http://unix: should be also supported by the fetcher
    // but it fails with node-fetch-unix as of v2.3.0
    if (url.startsWith('http://unix:')) {
      url = url.replace('http://unix:', 'unix:')
    }
    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      retry: {
        retries: 100,
      },
    })
    if (!response.ok) {
      throw await response.json()
    }
    const json = await response.json() as any // eslint-disable-line
    if (json.error) {
      throw json.error
    }
    return json as T
  })
}

async function requestPackage (
  remotePrefix: string,
  limitedFetch: (url: string, body: object) => any, // eslint-disable-line
  wantedDependency: WantedDependency,
  options: RequestPackageOptions
): Promise<PackageResponse> {
  const msgId = uuidv4()

  return limitedFetch(`${remotePrefix}/requestPackage`, {
    msgId,
    options,
    wantedDependency,
  })
    .then((packageResponseBody: object) => {
    const fetchingBundledManifest = !packageResponseBody['fetchingBundledManifestInProgress'] // eslint-disable-line
        ? undefined
        : limitedFetch(`${remotePrefix}/rawManifestResponse`, {
          msgId,
        })
    delete packageResponseBody['fetchingBundledManifestInProgress'] // eslint-disable-line

      if (options.skipFetch) {
        return {
          body: packageResponseBody,
          bundledManifest: fetchingBundledManifest && pShare(fetchingBundledManifest),
        }
      }

      const fetchingFiles = limitedFetch(`${remotePrefix}/packageFilesResponse`, {
        msgId,
      })
      return {
        body: packageResponseBody,
        bundledManifest: fetchingBundledManifest && pShare(fetchingBundledManifest),
        files: pShare(fetchingFiles),
        finishing: pShare(Promise.all([fetchingBundledManifest, fetchingFiles]).then(() => undefined)),
      }
    })
}

function fetchPackage (
  remotePrefix: string,
  limitedFetch: (url: string, body: object) => any, // eslint-disable-line
  options: FetchPackageToStoreOptions
): {
    bundledManifest?: () => Promise<DependencyManifest>
    files: () => Promise<PackageFilesResponse>
    filesIndexFile: string
    finishing: () => Promise<void>
    inStoreLocation: string
  } {
  const msgId = uuidv4()

  return limitedFetch(`${remotePrefix}/fetchPackage`, {
    msgId,
    options,
  })
    .then((fetchResponseBody: object & { filesIndexFile: string, inStoreLocation: string }) => {
      const fetchingBundledManifest = options.fetchRawManifest
        ? limitedFetch(`${remotePrefix}/rawManifestResponse`, { msgId })
        : undefined

      const fetchingFiles = limitedFetch(`${remotePrefix}/packageFilesResponse`, {
        msgId,
      })
      return {
        bundledManifest: fetchingBundledManifest && pShare(fetchingBundledManifest),
        files: pShare(fetchingFiles),
        filesIndexFile: fetchResponseBody.filesIndexFile,
        finishing: pShare(Promise.all([fetchingBundledManifest, fetchingFiles]).then(() => undefined)),
        inStoreLocation: fetchResponseBody.inStoreLocation,
      }
    })
}
