class BackgroundManager {
    static SPOTIFY_URL = 'https://open.spotify.com/*';

    static STYLE_IDS = {
        THEME: 'spoton-color-theme',
        CUSTOM: 'spoton-custom-css'
    };

    static STORAGE_KEYS = {
        SETTINGS: 'settings',
        CUSTOM_CSS: 'spoton-custom-css',
        NAV_COLOR: 'navColor',
        LYRICS_COLOR: 'lyricsColor'
    };

    static COMMAND_SELECTORS = {
        "play-pause": [
            ".spoticon-play-16",
            ".spoticon-pause-16",
            "[data-testid=control-button-play]",
            "[data-testid=control-button-pause]",
            "[data-testid=control-button-playpause]"
        ],
        "next": [
            ".spoticon-skip-forward-16",
            "[data-testid=control-button-skip-forward]"
        ],
        "previous": [
            ".spoticon-skip-back-16",
            "[data-testid=control-button-skip-back]"
        ],
        "shuffle": [
            ".spoticon-shuffle-16",
            "[data-testid=control-button-shuffle]"
        ],
        "repeat": [
            ".spoticon-repeat-16",
            ".spoticon-repeatonce-16",
            "[data-testid=control-button-repeat]"
        ],
        "like": [
            "button[aria-label='Add to Liked Songs']"
        ],
        "volume-mute": [
            ".volume-bar__icon-button.control-button",
            "[data-testid=volume-bar-toggle-mute-button]"
        ]
    };

    constructor() {
        this.initialize();
    }

    initialize() {
        this.registerInstallHandler();
        this.registerCommands();
        this.registerTabUpdates();
    }

    registerInstallHandler() {
        chrome.runtime.onInstalled.addListener(
            async ({ reason, previousVersion }) => {
                try {
                    await this.handleInstall(reason, previousVersion);
                } catch (error) {
                    console.error('[SpotOn] Install handler failed:', error);
                }
            }
        );
    }

    async handleInstall(reason, previousVersion) {
        if (!['install', 'update'].includes(reason)) return;

        if (
            reason === 'update' &&
            previousVersion &&
            this.isVersionLowerOrEqual(previousVersion, '3.1.0')
        ) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('update-notice.html')
            });
        }

        await this.initializeDefaultSettings();
        await chrome.storage.local.remove(
            BackgroundManager.STORAGE_KEYS.CUSTOM_CSS
        );
    }

    async initializeDefaultSettings() {
        const result = await chrome.storage.sync.get(
            BackgroundManager.STORAGE_KEYS.SETTINGS
        );

        if (result.settings) return;

        await chrome.storage.sync.set({
            settings: DEFAULT_SETTINGS
        });
    }

    registerCommands() {
        chrome.commands.onCommand.addListener(
            async (command) => {
                try {
                    const tabs = await chrome.tabs.query({
                        url: BackgroundManager.SPOTIFY_URL
                    });

                    await Promise.all(
                        tabs.map(tab =>
                            this.executeCommand(tab.id, command)
                        )
                    );
                } catch (error) {
                    console.error(
                        `[SpotOn] Command failed: ${command}`,
                        error
                    );
                }
            }
        );
    }

    async executeCommand(tabId, command) {
        return chrome.scripting.executeScript({
            target: { tabId },
            func: this.commandExecutor,
            args: [command, BackgroundManager.COMMAND_SELECTORS]
        });
    }

    commandExecutor(command, selectorsMap) {
        const DENY = '.extension-lyrics-button';

        const animate = (element) => {
            element.style.transition = 'transform .2s ease';
            element.style.transform = 'scale(1.15)';

            setTimeout(() => {
                element.style.transform = 'scale(1)';
            }, 200);
        };

        const clickElement = (element) => {
            if (!element) return;
            element.click();
            animate(element);
        };

        const setSliderValue = (selector, max) => {
            const slider = document.querySelector(selector);

            if (!slider) return;

            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value'
            ).set;

            setter.call(slider, max ? slider.max : slider.min);

            slider.dispatchEvent(
                new Event('change', { bubbles: true })
            );
        };

        if (command === 'volume-up') {
            return setSliderValue(
                '[class*=volume] input[type=range]',
                true
            );
        }

        if (command === 'volume-down') {
            return setSliderValue(
                '[class*=volume] input[type=range]',
                false
            );
        }

        const selectors = selectorsMap[command];

        if (!selectors) return;

        const query = selectors
            .map(s => `${s}:not(${DENY})`)
            .join(',');

        clickElement(document.querySelector(query));
    }

    registerTabUpdates() {
        chrome.tabs.onUpdated.addListener(
            async (tabId, changeInfo, tab) => {
                if (
                    changeInfo.status !== 'complete' ||
                    !tab.url?.startsWith('https://open.spotify.com/')
                ) {
                    return;
                }

                await this.applyStyles(tabId);
            }
        );
    }

    async applyStyles(tabId) {
        try {
            const [localData, syncData] = await Promise.all([
                chrome.storage.local.get([
                    BackgroundManager.STORAGE_KEYS.CUSTOM_CSS
                ]),
                chrome.storage.sync.get([
                    BackgroundManager.STORAGE_KEYS.NAV_COLOR,
                    BackgroundManager.STORAGE_KEYS.LYRICS_COLOR
                ])
            ]);

            const customCSS =
                localData[BackgroundManager.STORAGE_KEYS.CUSTOM_CSS];

            const css =
                customCSS ||
                this.generateThemeCSS(
                    syncData.navColor,
                    syncData.lyricsColor
                );

            if (!css) return;

            await this.injectStyle(
                tabId,
                BackgroundManager.STYLE_IDS.CUSTOM,
                css
            );

        } catch (error) {
            console.error('[SpotOn] Failed applying styles:', error);
        }
    }

    generateThemeCSS(navColor, lyricsColor) {
        let css = '';

        if (navColor) {
            css += `
.sidebar {
    ${
        navColor.includes('http')
            ? `
        background-image: url(${navColor}) !important;
        background-size: cover !important;
        background-repeat: no-repeat !important;
        `
            : `
        background-color: ${navColor} !important;
        `
    }
}
`;
        }

        if (lyricsColor) {
            css += `
.lyrics {
    color: ${lyricsColor} !important;
}
`;
        }

        return css;
    }

    async injectStyle(tabId, styleId, css) {
        await chrome.scripting.executeScript({
            target: { tabId },
            func: (styleId, css) => {
                document.getElementById(styleId)?.remove();

                const style = document.createElement('style');

                style.id = styleId;
                style.textContent = css;

                document.head.appendChild(style);
            },
            args: [styleId, css]
        });
    }

    isVersionLowerOrEqual(v1, v2) {
        const a = v1.split('.').map(Number);
        const b = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const x = a[i] || 0;
            const y = b[i] || 0;

            if (x < y) return true;
            if (x > y) return false;
        }

        return true;
    }
}

const DEFAULT_SETTINGS = {
    spoton: true,
    righter: true,
    font: true,
    fontLsize: true
    // ...
};

new BackgroundManager();
