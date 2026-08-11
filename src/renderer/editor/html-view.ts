import { $view } from '@milkdown/kit/utils'
import { htmlSchema } from '@milkdown/kit/preset/commonmark'
import type { NodeViewConstructor } from '@milkdown/kit/prose/view'

export const htmlView = $view(htmlSchema.node, (): NodeViewConstructor => {
  return (node) => {
    const dom = document.createElement('span')
    dom.classList.add('milkdown-html-inline')
    dom.innerHTML = node.attrs.value as string
    return {
      dom,
      stopEvent: () => true
    }
  }
})
