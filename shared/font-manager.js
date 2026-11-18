/**
 * =========================================================================
 * JCAH_TGenX / Studio Precision — Universal Font Manager
 * =========================================================================
 * 
 * Provides global typography customization across the entire interaction:
 * - Author Studio (Pipeline, Question Workbench, Editors, Preview)
 * - Candidate Exam Runtime (Welcome, Sections, Questions, Supervision, Results)
 * 
 * Supports:
 * 1. Default Platform Fonts (Plus Jakarta Sans / Inter)
 * 2. Curated Google Fonts (Inter, Roboto, Open Sans, Poppins, Montserrat, Lato,
 *    Nunito, Lexend, Source Sans 3, Atkinson Hyperlegible, Merriweather, Lora, Playfair)
 * 3. Any Google Font by Family Name or Google Fonts Embed URL
 * 4. Imported Custom Font Files (.woff2, .woff, .ttf, .otf), encoded as Base64
 *    Data URLs for 100% offline & air-gapped SCORM / Web packaging.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JCAHFontManager = factory();
    root.JCAHFontManager = root.JCAHFontManager; // Backwards compatibility alias
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const STORAGE_KEY = '__JCAH_INTERACTION_FONT__';
  const GOOGLE_LINK_ID = 'jcah-interaction-google-font';
  const CUSTOM_STYLE_ID = 'jcah-interaction-custom-font';

  const CURATED_GOOGLE_FONTS = [
    { name: 'Inter', category: 'Sans-Serif', desc: 'Clean, modern grotesque sans with high legibility' },
    { name: 'Roboto', category: 'Sans-Serif', desc: 'Modern geometric neo-grotesque standard' },
    { name: 'Open Sans', category: 'Sans-Serif', desc: 'Optimized for high legibility across screens' },
    { name: 'Poppins', category: 'Sans-Serif', desc: 'Geometric sans-serif with friendly curves' },
    { name: 'Montserrat', category: 'Sans-Serif', desc: 'Geometric sans inspired by urban typography' },
    { name: 'Lato', category: 'Sans-Serif', desc: 'Warm humanist proportions with sharp details' },
    { name: 'Nunito', category: 'Sans-Serif', desc: 'Balanced rounded sans-serif for comfortable reading' },
    { name: 'Lexend', category: 'Accessible', desc: 'Scientifically designed to reduce visual crowding' },
    { name: 'Source Sans 3', category: 'Sans-Serif', desc: 'Adobe open-source workhorse for UI and text' },
    { name: 'Atkinson Hyperlegible', category: 'Accessible', desc: 'Braille Institute font maximizing character distinction' },
    { name: 'Merriweather', category: 'Serif', desc: 'High-contrast editorial serif pleasant to read on screens' },
    { name: 'Lora', category: 'Serif', desc: 'Contemporary serif with balanced calligraphy flow' },
    { name: 'Playfair Display', category: 'Serif', desc: 'Classic transitional serif with refined elegance' },
    { name: 'JetBrains Mono', category: 'Monospace', desc: 'Developer monospace with clear distinctions' }
  ];

  /**
   * Detect font format from file extension or MIME type
   */
  function detectFontFormat(fileName, mimeType) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (ext === 'woff2' || (mimeType && mimeType.includes('woff2'))) return 'woff2';
    if (ext === 'woff' || (mimeType && mimeType.includes('woff'))) return 'woff';
    if (ext === 'ttf' || (mimeType && (mimeType.includes('truetype') || mimeType.includes('ttf')))) return 'truetype';
    if (ext === 'otf' || (mimeType && (mimeType.includes('opentype') || mimeType.includes('otf')))) return 'opentype';
    return 'woff2';
  }

  /**
   * Build Google Fonts CSS stylesheet URL for family name
   */
  function buildGoogleFontUrl(fontFamily) {
    if (!fontFamily) return '';
    const clean = String(fontFamily).trim();
    if (/^https?:\/\//i.test(clean)) {
      return clean; // Already a full Google Fonts URL
    }
    const familyParam = encodeURIComponent(clean).replace(/%20/g, '+');
    return `https://fonts.googleapis.com/css2?family=${familyParam}:ital,wght@0,300..800;1,300..800&display=swap`;
  }

  /**
   * Apply font configuration across the entire document
   * @param {Object} config - Exam object or font configuration
   */
  function applyFont(config) {
    if (!config || typeof document === 'undefined') return;

    const source = config.fontSource || 'default';
    const docEl = document.documentElement;
    const bodyEl = document.body;

    // Helper to get or create element in head
    function getOrCreateLink(id) {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('link');
        el.id = id;
        el.rel = 'stylesheet';
        document.head.appendChild(el);
      }
      return el;
    }

    function getOrCreateStyle(id) {
      let el = document.getElementById(id);
      if (!el) {
        el = document.createElement('style');
        el.id = id;
        document.head.appendChild(el);
      }
      return el;
    }

    if (source === 'default') {
      // Remove custom style & link
      const existingLink = document.getElementById(GOOGLE_LINK_ID);
      if (existingLink) existingLink.remove();
      const existingStyle = document.getElementById(CUSTOM_STYLE_ID);
      if (existingStyle) existingStyle.remove();

      // Reset CSS variables
      docEl.style.removeProperty('--font-body');
      docEl.style.removeProperty('--font-headline');
      docEl.style.removeProperty('--font-display');
      docEl.removeAttribute('data-custom-font');
      if (bodyEl) bodyEl.removeAttribute('data-custom-font');

      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
      return;
    }

    let fontFamily = config.fontFamily || '';

    if (source === 'google' || source === 'preset') {
      const googleName = config.googleFontName || fontFamily || 'Inter';
      fontFamily = googleName.replace(/\+/g, ' ').replace(/:.*/, '').trim();
      const fontUrl = buildGoogleFontUrl(googleName);

      // Remove custom uploaded style if switching
      const existingStyle = document.getElementById(CUSTOM_STYLE_ID);
      if (existingStyle) existingStyle.remove();

      const link = getOrCreateLink(GOOGLE_LINK_ID);
      if (link.href !== fontUrl) {
        link.href = fontUrl;
      }
    } else if (source === 'custom' && config.customFontDataUrl) {
      // Remove Google link if switching
      const existingLink = document.getElementById(GOOGLE_LINK_ID);
      if (existingLink) existingLink.remove();

      fontFamily = config.customFontName || 'JCAHCustomUploadedFont';
      const fmt = config.customFontFormat || detectFontFormat(config.customFontFileName, '');
      const style = getOrCreateStyle(CUSTOM_STYLE_ID);
      style.textContent = `
        @font-face {
          font-family: '${fontFamily}';
          src: url('${config.customFontDataUrl}') format('${fmt}');
          font-weight: 100 900;
          font-style: normal;
          font-display: swap;
        }
      `;
    }

    if (!fontFamily) return;

    // Apply CSS variables to root
    const fontStack = `"${fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
    docEl.style.setProperty('--font-body', fontStack);
    docEl.style.setProperty('--font-headline', fontStack);
    docEl.style.setProperty('--font-display', fontStack);

    docEl.setAttribute('data-custom-font', 'true');
    if (bodyEl) bodyEl.setAttribute('data-custom-font', 'true');

    // Persist configuration in localStorage for instant pre-paint restoration
    try {
      const persistable = {
        fontSource: source,
        fontFamily: fontFamily,
        googleFontName: config.googleFontName || '',
        customFontName: config.customFontName || '',
        customFontFileName: config.customFontFileName || '',
        customFontFormat: config.customFontFormat || '',
        // Only persist custom data URL in localStorage if it fits safely (< 2MB)
        customFontDataUrl: (config.customFontDataUrl && config.customFontDataUrl.length < 2000000) ? config.customFontDataUrl : ''
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
    } catch (_) {}
  }

  /**
   * Restore font immediately on page boot (call early in head to avoid flash)
   */
  function restoreEarly() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          applyFont(parsed);
        }
      }
    } catch (_) {}
  }

  /**
   * Reset font configuration to system default
   */
  function resetFont(exam) {
    if (exam) {
      exam.fontSource = 'default';
      exam.fontFamily = '';
      exam.googleFontName = '';
      exam.customFontName = '';
      exam.customFontDataUrl = '';
      exam.customFontFileName = '';
      exam.customFontFormat = '';
    }
    applyFont({ fontSource: 'default' });
  }

  return {
    CURATED_GOOGLE_FONTS,
    detectFontFormat,
    buildGoogleFontUrl,
    applyFont,
    restoreEarly,
    restoreSaved: restoreEarly,
    resetFont,
    getCuratedFonts: () => [...CURATED_GOOGLE_FONTS]
  };
});
