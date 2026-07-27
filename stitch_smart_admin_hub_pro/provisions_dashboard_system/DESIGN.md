---
name: Provisions Dashboard System
colors:
  surface: '#f7fafc'
  surface-dim: '#d7dadc'
  surface-bright: '#f7fafc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f1f4f6'
  surface-container: '#ebeef0'
  surface-container-high: '#e5e9eb'
  surface-container-highest: '#e0e3e5'
  on-surface: '#181c1e'
  on-surface-variant: '#43474e'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eef1f3'
  outline: '#74777f'
  outline-variant: '#c4c6cf'
  surface-tint: '#455f88'
  primary: '#002045'
  on-primary: '#ffffff'
  primary-container: '#1a365d'
  on-primary-container: '#86a0cd'
  inverse-primary: '#adc7f7'
  secondary: '#9d4400'
  on-secondary: '#ffffff'
  secondary-container: '#fe8439'
  on-secondary-container: '#662900'
  tertiary: '#002713'
  on-tertiary: '#ffffff'
  tertiary-container: '#003f23'
  on-tertiary-container: '#4bb278'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d6e3ff'
  primary-fixed-dim: '#adc7f7'
  on-primary-fixed: '#001b3c'
  on-primary-fixed-variant: '#2d476f'
  secondary-fixed: '#ffdbca'
  secondary-fixed-dim: '#ffb68f'
  on-secondary-fixed: '#331100'
  on-secondary-fixed-variant: '#773200'
  tertiary-fixed: '#91f8b8'
  tertiary-fixed-dim: '#74db9d'
  on-tertiary-fixed: '#002110'
  on-tertiary-fixed-variant: '#00522f'
  background: '#f7fafc'
  on-background: '#181c1e'
  surface-variant: '#e0e3e5'
typography:
  display-metrics:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 32px
  xl: 48px
  container-max: 1440px
  gutter: 24px
---

## Brand & Style

The brand personality for this design system is **Professional, Dependable, and Community-Focused**. Designed specifically for social welfare organization kiosk operators, the UI prioritizes clarity and efficiency while maintaining a warm, approachable tone.

The visual style is **Corporate / Modern** with a strong emphasis on card-based modularity. It utilizes a structured hierarchy to help operators manage inventory and sales data at a glance. The atmosphere is grounded and utilitarian, ensuring that mission-critical information is never obscured by decorative elements, yet it avoids the coldness of traditional enterprise software through the use of soft elevation and vibrant accent colors.

## Colors

The color palette is anchored by **Deep Navy (#1A365D)**, used for primary navigation and structural elements to establish authority and stability. **Kitchen Orange (#DD6B20)** serves as the high-energy action color, drawing attention to critical tasks and "New Order" triggers. **Success Green (#38A169)** is reserved for positive data trends, completed transactions, and "In Stock" indicators.

The background uses a soft off-white neutral to reduce eye strain during long shifts. High-contrast text is maintained throughout to ensure accessibility for all operators.

## Typography

This design system uses **Hanken Grotesk** as the primary typeface for its modern, clean, and highly legible characteristics. To emphasize key metrics like daily revenue or low-stock alerts, "Extra Bold" weights are applied to the `display-metrics` role. 

**JetBrains Mono** is introduced sparingly for labels and ID tags (e.g., Transaction IDs, SKU numbers) to provide a technical, precise feel that distinguishes data strings from conversational UI text. Large headlines scale down on mobile devices to prevent awkward line breaks in card headers.

## Layout & Spacing

The layout utilizes a **12-column fluid grid** on desktop, transitioning to a **single-column vertical flow** on mobile devices. 

- **Desktop:** Dashboard widgets use a masonry-style arrangement or a strict multi-column grid depending on content density. Margins are set to `32px` to provide significant "breathing room" around high-density data.
- **Mobile:** Margins shrink to `16px`. Cards expand to the full width of the screen to maximize touch targets.
- **Rhythm:** An 8px-based spacing system governs all internal component padding, ensuring a consistent visual cadence across the interface.

## Elevation & Depth

This design system employs **Ambient Shadows** to create a clear sense of hierarchy without the harshness of heavy borders. 

- **Surface Level (Level 0):** The main application background, using the neutral light grey.
- **Card Level (Level 1):** Primary content containers. These use a very soft, diffused shadow (Y: 4px, Blur: 12px, Opacity: 5% Black) to appear slightly lifted.
- **Interaction Level (Level 2):** Hover states and active dropdowns. Shadows become tighter and slightly darker (Y: 8px, Blur: 20px, Opacity: 10% Black) to indicate "pick-up" or "active" status.
- **Modals:** Use a significant backdrop blur (8px) to isolate the user's focus during critical administrative actions.

## Shapes

The shape language is defined by **12px (rounded-lg)** corners for all primary dashboard cards and containers. This specific radius strikes a balance between the precision of professional software and the friendliness of a social organization's brand.

Small elements like buttons and input fields utilize an 8px radius, while tags and status chips use a fully rounded (pill-shaped) radius to distinguish them from interactive buttons.

## Components

### Buttons
- **Primary:** Kitchen Orange background with white text. Bold weight. Used for the main action (e.g., "Add Stock").
- **Secondary:** Deep Navy outline with Navy text. Used for secondary navigation.
- **Ghost:** No background or border; used for "Cancel" or "Dismiss" actions.

### Cards
All dashboard modules reside in cards. Headers within cards should use `headline-md` with a subtle bottom border (1px, light grey) to separate titles from content.

### Inputs & Selection
- **Fields:** 12px height padding, 1px neutral border. Focus state uses a 2px Kitchen Orange ring.
- **Checkboxes:** Square with a 4px radius, using Success Green when checked.

### Chips & Badges
Used for status. "Low Stock" uses a soft red tint, "Healthy Stock" uses a soft green tint, and "Processing" uses a soft navy tint. Text should be uppercase `label-caps`.

### List Items
For recent transactions, use a horizontal layout with a 1px divider. Each row should have a minimum height of 64px to remain touch-friendly on mobile tablets.