class ContentManager {
    static STYLE_PREFIX = 'spoton';
    static BACKGROUND_STYLE_ID = 'spoton-background';

    constructor() {
        this.features = new Map();
        this.styleCache = new Map();
        this.styleNodes = new Map();

        this.themeLock = false;
        this.savedBackgroundImage = null;

        this.coverArtObserver = null;
        this.pageObserver = null;

        this.settingsSaveTimeout = null;

        this.initialize();
    }

    async initialize() {
        await this.loadSettings();

        this.setupMessageListener();
        this.setupPageObserver();

        await this.applyEnabledFeatures();

        this.initializeAlbumArt();
    }

    async loadSettings() {
        try {
            const { features } = await chrome.storage.sync.get('features');

            Object.entries({
                ...DEFAULT_FEATURES,
                ...(features || {})
            }).forEach(([key, value]) => {
                this.features.set(key, value);
            });

        } catch (error) {
            console.error('[SpotOn] Failed loading settings:', error);
        }
    }

    async saveSettings() {
        try {
            await chrome.storage.sync.set({
                features: Object.fromEntries(this.features)
            });

        } catch (error) {
            console.error('[SpotOn] Failed saving settings:', error);
        }
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener(
            async (message, sender, sendResponse) => {
                try {
                    await this.handleMessage(message);

                    sendResponse({ success: true });

                } catch (error) {
                    console.error('[SpotOn] Message error:', error);

                    sendResponse({
                        success: false,
                        error: error.message
                    });
                }

                return true;
            }
        );
    }

    async handleMessage(message) {
        switch (message.type) {
            case 'TOGGLE_FEATURE':
                return this.toggleFeature(
                    message.feature,
                    message.enabled
                );

            case 'GET_FEATURES':
                return {
                    features: Object.fromEntries(this.features)
                };

            case 'TOGGLE_THEME_LOCK':
                return this.toggleThemeLock(message.locked);
        }
    }

    async toggleFeature(feature, enabled) {
        if (this.features.get(feature) === enabled) {
            return;
        }

        this.features.set(feature, enabled);

        await this.saveSettingsDebounced();

        if (enabled) {
            await this.enableFeature(feature);
        } else {
            this.disableFeature(feature);
        }
    }

    async applyEnabledFeatures() {
        const enabledFeatures = [...this.features.entries()]
            .filter(([, enabled]) => enabled);

        await Promise.all(
            enabledFeatures.map(([feature]) =>
                this.enableFeature(feature)
            )
        );
    }

    async enableFeature(feature) {
        const styleId = this.getStyleId(feature);

        if (document.getElementById(styleId)) {
            return;
        }

        const css = await this.loadFeatureCSS(feature);

        if (!css) return;

        const style = document.createElement('style');

        style.id = styleId;
        style.textContent = css;

        document.head.appendChild(style);

        this.styleNodes.set(feature, style);
    }

    disableFeature(feature) {
        const style = document.getElementById(
            this.getStyleId(feature)
        );

        style?.remove();

        this.styleNodes.delete(feature);
    }

    async loadFeatureCSS(feature) {
        if (this.styleCache.has(feature)) {
            return this.styleCache.get(feature);
        }

        const fileName = FEATURE_CSS_MAP[feature];

        if (!fileName) {
            console.warn(
                `[SpotOn] Missing CSS mapping: ${feature}`
            );

            return null;
        }

        try {
            const response = await fetch(
                chrome.runtime.getURL(`css/${fileName}`)
            );

            if (!response.ok) {
                throw new Error(`Failed loading ${fileName}`);
            }

            const css = await response.text();

            this.styleCache.set(feature, css);

            return css;

        } catch (error) {
            console.error(
                `[SpotOn] CSS load failed for ${feature}`,
                error
            );

            return null;
        }
    }

    getStyleId(feature) {
        return `${ContentManager.STYLE_PREFIX}-${feature}`;
    }

    async saveSettingsDebounced() {
        clearTimeout(this.settingsSaveTimeout);

        this.settingsSaveTimeout = setTimeout(
            () => this.saveSettings(),
            1000
        );
    }

    setupPageObserver() {
        if (this.pageObserver) {
            this.pageObserver.disconnect();
        }

        this.pageObserver = new MutationObserver(
            this.handlePageMutations.bind(this)
        );

        this.pageObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    handlePageMutations(mutations) {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) {
                    continue;
                }

                const coverArt = node.querySelector(
                    '[data-testid="CoverSlotCollapsed__container"] img'
                );

                if (coverArt) {
                    this.attachAlbumArtListener(coverArt);
                }
            }
        }
    }

    initializeAlbumArt() {
        const coverArt = document.querySelector(
            '[data-testid="cover-art-image"]'
        );

        if (!coverArt) {
            requestAnimationFrame(() =>
                this.initializeAlbumArt()
            );

            return;
        }

        this.attachAlbumArtListener(coverArt);

        this.observeAlbumArt(coverArt);

        this.updateBackground(coverArt.src);
    }

    attachAlbumArtListener(image) {
        image.addEventListener(
            'load',
            () => {
                if (!this.themeLock) {
                    this.updateBackground(image.src);
                }
            },
            { passive: true }
        );
    }

    observeAlbumArt(image) {
        if (this.coverArtObserver) {
            this.coverArtObserver.disconnect();
        }

        this.coverArtObserver = new MutationObserver(() => {
            if (!this.themeLock) {
                this.updateBackground(image.src);
            }
        });

        this.coverArtObserver.observe(image, {
            attributes: true,
            attributeFilter: ['src']
        });
    }

    updateBackground(imageUrl) {
        if (!imageUrl) return;

        this.savedBackgroundImage = imageUrl;

        let style = document.getElementById(
            ContentManager.BACKGROUND_STYLE_ID
        );

        if (!style) {
            style = document.createElement('style');

            style.id = ContentManager.BACKGROUND_STYLE_ID;

            document.head.appendChild(style);
        }

        style.textContent = `
            :root {
                --backimg: url("${imageUrl}");
            }
        `;
    }

    toggleThemeLock(locked) {
        this.themeLock = locked;

        if (
            locked &&
            this.savedBackgroundImage
        ) {
            this.updateBackground(
                this.savedBackgroundImage
            );

            this.coverArtObserver?.disconnect();

            return;
        }

        this.initializeAlbumArt();
    }

    destroy() {
        this.coverArtObserver?.disconnect();
        this.pageObserver?.disconnect();

        clearTimeout(this.settingsSaveTimeout);

        this.styleNodes.forEach(style => style.remove());

        this.styleNodes.clear();
        this.styleCache.clear();
    }
}

const FEATURE_CSS_MAP = {
    spoton: 'spoton.css',
    righter: 'righter.css',
    font: 'fontMain.css',
    shadow: 'shadow.css',
    roundAlbumArt: 'roundAlbumArt.css'
};

const DEFAULT_FEATURES = {
    spoton: true,
    righter: true,
    font: true,
    shadow: false,
    roundAlbumArt: false
};

new ContentManager();
