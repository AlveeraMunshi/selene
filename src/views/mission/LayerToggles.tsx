/**
 * Map layer visibility.
 *
 * These are preferences rather than mission state, so the store persists them
 * and a reload comes back with the same map. They write through
 * `setRenderOption`, which is also what keeps hover and selection -- which
 * change on every mouse move -- out of localStorage.
 */

import { LAYER_TOGGLES } from '@/state/defaults'
import { useRenderOptions, useSetRenderOption } from '@/state/selectors'
import { Toggle } from '@/ui'

export function LayerToggles() {
  const options = useRenderOptions()
  const setOption = useSetRenderOption()

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {LAYER_TOGGLES.map(({ key, label, hint }) => (
        <Toggle
          key={key}
          checked={options[key]}
          onChange={(next) => setOption(key, next)}
          label={label}
          hint={hint}
        />
      ))}
    </div>
  )
}
