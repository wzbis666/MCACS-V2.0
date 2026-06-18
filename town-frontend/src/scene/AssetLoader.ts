import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'

const BASE = import.meta.env.BASE_URL + 'assets/models'

const MANIFEST = {
  buildings: {
    'building_A': `${BASE}/buildings/building_A.gltf`,
    'building_B': `${BASE}/buildings/building_B.gltf`,
    'building_C': `${BASE}/buildings/building_C.gltf`,
    'building_D': `${BASE}/buildings/building_D.gltf`,
    'building_E': `${BASE}/buildings/building_E.gltf`,
    'building_F': `${BASE}/buildings/building_F.gltf`,
    'building_G': `${BASE}/buildings/building_G.gltf`,
    'base': `${BASE}/buildings/base.gltf`,
  },
  props: {
    'bench': `${BASE}/props/bench.gltf`,
    'streetlight': `${BASE}/props/streetlight.gltf`,
    'bush': `${BASE}/props/bush.gltf`,
    'firehydrant': `${BASE}/props/firehydrant.gltf`,
    'car_sedan': `${BASE}/props/car_sedan.gltf`,
    'car_hatchback': `${BASE}/props/car_hatchback.gltf`,
    'car_taxi': `${BASE}/props/car_taxi.gltf`,
    'capybara': `${BASE}/props/capybara.glb`,
  },
  characters: {
    'character-male-a': `${BASE}/characters/character-male-a.glb`,
    'character-male-b': `${BASE}/characters/character-male-b.glb`,
    'character-male-c': `${BASE}/characters/character-male-c.glb`,
    'character-male-d': `${BASE}/characters/character-male-d.glb`,
    'character-male-e': `${BASE}/characters/character-male-e.glb`,
    'character-male-f': `${BASE}/characters/character-male-f.glb`,
    'character-female-a': `${BASE}/characters/character-female-a.glb`,
    'character-female-b': `${BASE}/characters/character-female-b.glb`,
    'character-female-c': `${BASE}/characters/character-female-c.glb`,
    'character-female-d': `${BASE}/characters/character-female-d.glb`,
    'character-female-e': `${BASE}/characters/character-female-e.glb`,
    'character-female-f': `${BASE}/characters/character-female-f.glb`,
  },
} as const

type Category = keyof typeof MANIFEST

interface CachedAsset {
  model: THREE.Group
  animations: THREE.AnimationClip[]
  hasSkinnedMesh: boolean
}

export class AssetLoader {
  private loader = new GLTFLoader()
  private cache = new Map<string, CachedAsset>()

  async preload(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const entries: [string, string][] = []
    for (const cat of Object.keys(MANIFEST) as Category[]) {
      for (const [key, url] of Object.entries(MANIFEST[cat])) {
        entries.push([`${cat}/${key}`, url])
      }
    }

    let done = 0
    const total = entries.length

    const loadOne = async ([key, url]: [string, string]) => {
      try {
        const gltf = await this.loader.loadAsync(url)
        const model = gltf.scene
        let hasSkin = false
        model.traverse(child => {
          if ((child as THREE.Mesh).isMesh) {
            child.castShadow = true
            child.receiveShadow = true
          }
          if ((child as THREE.SkinnedMesh).isSkinnedMesh) {
            hasSkin = true
          }
        })
        this.cache.set(key, {
          model,
          animations: gltf.animations ?? [],
          hasSkinnedMesh: hasSkin,
        })
      } catch {
        console.warn(`[AssetLoader] Failed to load: ${key}`)
      }
      done++
      onProgress?.(done, total)
    }

    const batchSize = 6
    for (let i = 0; i < entries.length; i += batchSize) {
      await Promise.all(entries.slice(i, i + batchSize).map(loadOne))
    }
  }

  private getCached(category: Category, key: string): CachedAsset | null {
    return this.cache.get(`${category}/${key}`) ?? null
  }

  /** Clone model — uses SkeletonUtils.clone for skinned meshes, regular clone otherwise */
  private cloneModel(cached: CachedAsset): THREE.Group {
    if (cached.hasSkinnedMesh) {
      return SkeletonUtils.clone(cached.model) as THREE.Group
    }
    return cached.model.clone()
  }

  getModel(category: Category, key: string): THREE.Group | null {
    const cached = this.getCached(category, key)
    if (!cached) return null
    return this.cloneModel(cached)
  }

  getAnimations(category: Category, key: string): THREE.AnimationClip[] {
    const cached = this.getCached(category, key)
    return cached?.animations ?? []
  }

  getBuildingModel(key: string): THREE.Group | null {
    return this.getModel('buildings', key)
  }

  getPropModel(key: string): THREE.Group | null {
    return this.getModel('props', key)
  }

  /** Get character model clone with animations — always uses SkeletonUtils.clone */
  getCharacterModel(key: string): THREE.Group | null {
    const cached = this.getCached('characters', key)
    if (!cached) return null
    const cloned = this.cloneModel(cached)
    cloned.animations = cached.animations
    return cloned
  }

  /** Get a random character model — each NPC gets a unique appearance */
  getRandomCharacterModel(): THREE.Group | null {
    const keys = Object.keys(MANIFEST.characters)
    const key = keys[Math.floor(Math.random() * keys.length)]
    return this.getCharacterModel(key)
  }

  /** Get all available character keys */
  getCharacterKeys(): string[] {
    return Object.keys(MANIFEST.characters)
  }
}
