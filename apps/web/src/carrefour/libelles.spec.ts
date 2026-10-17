import { describe, expect, it } from 'vitest'
import { libellePlage } from './libelles'

describe('libellé d’une plage horaire', () => {
  it('résume les jours qui se suivent et la journée entière', () => {
    expect(libellePlage({ jours: ['lun', 'mar', 'mer', 'jeu', 'ven'], de: '07:00', a: '09:30' })).toBe('lun.–ven. 07:00–09:30')
    expect(libellePlage({ jours: 'tous', de: '00:00', a: '00:00' })).toBe('tous les jours, toute la journée')
  })

  it('énumère les jours qui ne se suivent pas, ou seulement deux', () => {
    expect(libellePlage({ jours: ['dim', 'mer'], de: '22:00', a: '06:00' })).toBe('mer., dim. 22:00–06:00')
    expect(libellePlage({ jours: ['sam', 'dim'], de: '08:00', a: '20:00' })).toBe('sam., dim. 08:00–20:00')
  })
})
