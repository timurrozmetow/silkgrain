/**
 * The visibility half of a panel that stays mounted while closed.
 *
 * Every overlay in this product - the cart drawer, the search panel, the mega-menu, the mobile
 * nav - stays in the DOM and animates on a transform, so the slide runs in both directions. A
 * focus trap then keeps focus inside while the panel is open. What that combination misses is
 * the closed state: `aria-hidden` hides a panel from a screen reader but does nothing to the tab
 * order, so a closed drawer's Checkout button is still reachable by Tab. axe calls it
 * `aria-hidden-focus`, and it is the real thing - a keyboard user tabbing off the header lands
 * inside a panel they cannot see.
 *
 * `visibility: hidden` fixes it, and is the reason this is not `opacity-0`: hidden content is
 * removed from the tab order, transparent content is not.
 *
 * It also does not break the exit animation, which is the usual objection. Visibility animates
 * discretely, and the rule is that any intermediate value counts as `visible` - so a panel
 * transitioning to hidden stays visible for the whole duration and flips at the end, while one
 * transitioning to visible flips immediately. Both are what the animation needs, provided
 * `visibility` is named in the element's `transition-property` beside the transform.
 */
export function panelVisibility(open: boolean): 'visible' | 'invisible' {
  return open ? 'visible' : 'invisible';
}
