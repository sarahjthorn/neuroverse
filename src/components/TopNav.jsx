import { useLayoutEffect, useRef } from 'react'
import ThemeSwitcher from './ThemeSwitcher'
import TabPicker from './TabPicker'
import { BrainIcon } from './icons'
import { CORE_TABS, OPTIONAL_TABS } from '../tabs'
import './TopNav.css'

// Top-level nav: one tab per full-page view. Past the core four, tabs are
// optional and switched on from the "+" (TabPicker) - see src/tabs.js. When the window
// is too narrow for them all, the tabs scroll sideways and the "+" stays put.
function TopNav({ view, onChangeView, theme, onChangeTheme, homeBadgeCount, openQuestionCount = 0, enabledTabs = [], onToggleTab, search }) {
  const views = [
    ...CORE_TABS,
    ...OPTIONAL_TABS.filter(t => t.status === 'ready' && enabledTabs.includes(t.id))
  ]
  const tabsRef = useRef(null)
  const indicatorRef = useRef(null)

  // One highlight pill that slides to the active tab, rather than each tab
  // lighting up on its own. Placed without a transition the first time (and
  // on resizes), so it only glides when you actually switch views.
  const placeIndicator = (animate) => {
    const tabs = tabsRef.current
    const pill = indicatorRef.current
    if (!tabs || !pill) return
    const active = tabs.querySelector('.top-nav-tab.active')
    if (!active) {
      pill.style.opacity = '0'
      return
    }
    if (!animate) pill.style.transition = 'none'
    pill.style.opacity = '1'
    pill.style.width = `${active.offsetWidth}px`
    pill.style.transform = `translateX(${active.offsetLeft}px)`
    // In a narrow window the tabs scroll sideways - keep the active one in view.
    if (active.offsetLeft < tabs.scrollLeft) {
      tabs.scrollLeft = active.offsetLeft
    } else if (active.offsetLeft + active.offsetWidth > tabs.scrollLeft + tabs.clientWidth) {
      tabs.scrollLeft = active.offsetLeft + active.offsetWidth - tabs.clientWidth
    }
    if (!animate) {
      pill.getBoundingClientRect()
      pill.style.transition = ''
    }
  }

  // Fade whichever edge has more tabs scrolled out of sight past it.
  const updateFades = () => {
    const tabs = tabsRef.current
    if (!tabs) return
    tabs.classList.toggle('fade-start', tabs.scrollLeft > 1)
    tabs.classList.toggle('fade-end', tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1)
  }

  // Switching views (or a badge changing a tab's width) glides the pill;
  // the very first placement doesn't.
  const placedOnce = useRef(false)
  useLayoutEffect(() => {
    placeIndicator(placedOnce.current)
    placedOnce.current = true
    updateFades()
  }, [view, homeBadgeCount, openQuestionCount, enabledTabs])

  // Window resizes / font load snap it into place. Observed once - a
  // ResizeObserver reports immediately on observe(), and re-creating it per
  // view change made that report cancel the glide.
  useLayoutEffect(() => {
    let first = true
    const observer = new ResizeObserver(() => {
      updateFades()
      if (first) { first = false; return }
      placeIndicator(false)
    })
    const tabs = tabsRef.current
    observer.observe(tabs)
    tabs.addEventListener('scroll', updateFades, { passive: true })
    return () => {
      observer.disconnect()
      tabs.removeEventListener('scroll', updateFades)
    }
  }, [])

  return (
    <header className="top-nav">
      <button type="button" className="top-nav-brand" onClick={() => onChangeView('home')} aria-label="Neuroverse - go to Home">
        <BrainIcon />
        <span>Neuroverse</span>
      </button>

      <div className="top-nav-tabs-wrap">
      <nav className="top-nav-tabs" ref={tabsRef}>
        <span className="top-nav-indicator" ref={indicatorRef} aria-hidden="true" />
        {views.map(v => (
          <button
            key={v.id}
            type="button"
            className={`top-nav-tab ${view === v.id ? 'active' : ''}`}
            onClick={() => onChangeView(v.id)}
          >
            {v.label}
            {v.id === 'home' && homeBadgeCount > 0 && (
              <span className="top-nav-dot" aria-label={`${homeBadgeCount} new`} />
            )}
            {v.id === 'reflect' && openQuestionCount > 0 && (
              <span className="top-nav-dot" aria-label={`${openQuestionCount} open question${openQuestionCount === 1 ? '' : 's'}`} />
            )}
            {v.badge && <span className="top-nav-chip">{v.badge}</span>}
          </button>
        ))}
      </nav>
      {onToggleTab && <TabPicker enabled={enabledTabs} onToggle={onToggleTab} />}
      </div>

      {search}
      <button
        type="button"
        className={`theme-toggle top-nav-about${view === 'about' ? ' active' : ''}`}
        onClick={() => onChangeView('about')}
        aria-label="About Neuroverse"
        aria-current={view === 'about' ? 'page' : undefined}
        title="About Neuroverse"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7.2v4" />
          <circle cx="8" cy="4.9" r="0.5" fill="currentColor" />
        </svg>
      </button>
      <ThemeSwitcher theme={theme} onChange={onChangeTheme} />
    </header>
  )
}

export default TopNav
