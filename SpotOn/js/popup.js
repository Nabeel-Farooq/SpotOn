import { SpotifyAPI } from './utils/spotify-api.js';
import { featureConfig } from './utils/feature-config.js';
import { ColorTheming } from './utils/color-theming.js';

class PopupManager {
    constructor() {
        this.spotifyAPI = new SpotifyAPI();

        this.state = {
            currentTrack: null,
            currentTheme: 'dark',
            customColors: null,
            themeLocked: false,
            downloading: false
        };

        this.elements = this.cacheElements();

        this.updateInterval = null;

        this.initialize();
    }

    cacheElements() {
        return {
            tabButtons: [...document.querySelectorAll('.tab-button')],
            featuresContainer: $('#features-container'),
            cssEditorSection: $('#css-editor-section'),

            settingsPanel: $('#settings-panel'),
            settingsToggle: $('#settings-toggle'),
            closeSettings: $('#close-settings'),

            themeToggle: $('#theme-toggle'),
            themeIcon: $('#theme-toggle .icon'),
            themeSelect: $('#theme-select'),
            themeLock: $('#theme-lock'),

            customTheme: $('#custom-theme'),
            primaryColor: $('#primary-color'),
            secondaryColor: $('#secondary-color'),

            albumArt: $('#album-art'),
            trackTitle: $('#track-title'),
            trackArtist: $('#track-artist'),

            copyInfo: $('#copy-info'),
            searchGenius: $('#search-genius'),
            downloadArt: $('#download-art'),

            exportSettings: $('#export-settings'),
            importSettings: $('#import-settings'),
            importFile: $('#import-file')
        };
    }

    async initialize() {
        await this.loadInitialState();

        this.renderFeatures();

        this.setupListeners();

        this.applyTheme();

        this.startNowPlayingUpdates();
    }

    async loadInitialState() {
        try {
            const storage = await chrome.storage.sync.get([
                'settings',
                'theme',
                'customColors',
                'themeLock'
            ]);

            this.settings = storage.settings || {};

            this.state.currentTheme =
                storage.theme || 'dark';

            this.state.customColors =
                storage.customColors || null;

            this.state.themeLocked =
                storage.themeLock || false;

        } catch (error) {
            console.error(
                '[SpotOn] Failed loading popup state:',
                error
            );
        }
    }

    renderFeatures() {
        this.elements.featuresContainer.innerHTML = '';

        Object.entries(featureConfig).forEach(
            ([tabId, config]) => {
                const section = this.createFeatureSection(
                    tabId,
                    config
                );

                this.elements.featuresContainer.appendChild(
                    section
                );
            }
        );
    }

    createFeatureSection(tabId, config) {
        const section = document.createElement('section');

        section.id = `${tabId}-features`;

        section.className = `
            features-section
            ${tabId === 'main' ? 'active' : ''}
        `;

        const grid = document.createElement('div');

        grid.className = 'feature-grid';

        const features =
            config.sections || [{ features: config.features }];

        features.forEach(group => {
            if (group.title) {
                const title = document.createElement('h4');

                title.textContent = group.title;

                grid.appendChild(title);
            }

            group.features.forEach(feature => {
                grid.appendChild(
                    this.createFeatureItem(feature)
                );
            });
        });

        section.appendChild(grid);

        return section;
    }

    createFeatureItem(feature) {
        const item = document.createElement('div');

        item.className = 'feature-item';

        item.innerHTML = `
            <input
                type="checkbox"
                class="feature-toggle"
                id="${feature.id}"
                ${this.settings[feature.id] ? 'checked' : ''}
            />

            <label for="${feature.id}">
                ${feature.label}
            </label>
        `;

        return item;
    }

    setupListeners() {
        this.setupTabs();

        this.setupThemeControls();

        this.setupFeatureToggles();

        this.setupQuickActions();

        this.setupImportExport();
    }

    setupTabs() {
        this.elements.tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                this.switchTab(button.dataset.tab);
            });
        });
    }

    switchTab(tab) {
        this.elements.tabButtons.forEach(btn => {
            btn.classList.toggle(
                'active',
                btn.dataset.tab === tab
            );
        });

        const isCSS = tab === 'css';

        this.elements.featuresContainer.style.display =
            isCSS ? 'none' : 'block';

        this.elements.cssEditorSection.style.display =
            isCSS ? 'block' : 'none';

        if (isCSS) {
            new ColorTheming();
        }

        document
            .querySelectorAll('.features-section')
            .forEach(section => {
                section.classList.toggle(
                    'active',
                    section.id === `${tab}-features`
                );
            });
    }

    setupThemeControls() {
        this.elements.themeToggle?.addEventListener(
            'click',
            () => {
                this.toggleTheme();
            }
        );

        this.elements.primaryColor?.addEventListener(
            'change',
            () => this.updateCustomColors()
        );

        this.elements.secondaryColor?.addEventListener(
            'change',
            () => this.updateCustomColors()
        );
    }

    async toggleTheme() {
        this.state.currentTheme =
            this.state.currentTheme === 'dark'
                ? 'custom'
                : 'dark';

        await chrome.storage.sync.set({
            theme: this.state.currentTheme,
            customColors:
                this.state.currentTheme === 'custom'
                    ? this.state.customColors
                    : null
        });

        this.applyTheme();
    }

    applyTheme() {
        document.body.classList.toggle(
            'custom-theme',
            this.state.currentTheme === 'custom'
        );

        if (
            this.state.currentTheme === 'custom' &&
            this.state.customColors
        ) {
            this.applyCustomColors(
                this.state.customColors
            );
        }

        this.updateThemeIcon();
    }

    applyCustomColors(colors) {
        const root = document.documentElement;

        root.style.setProperty(
            '--accent-color',
            colors.primary
        );

        root.style.setProperty(
            '--secondary-color',
            colors.secondary
        );
    }

    updateThemeIcon() {
        if (!this.elements.themeIcon) return;

        const dark =
            this.state.currentTheme === 'dark';

        this.elements.themeIcon.src =
            `assets/svg/${dark ? 'moon' : 'palette'}.svg`;
    }

    setupFeatureToggles() {
        document.addEventListener('change', async event => {
            const toggle = event.target;

            if (
                !toggle.classList.contains(
                    'feature-toggle'
                )
            ) {
                return;
            }

            const feature = toggle.id;
            const enabled = toggle.checked;

            this.settings[feature] = enabled;

            await chrome.storage.sync.set({
                settings: this.settings
            });

            this.broadcastMessage({
                type: 'TOGGLE_FEATURE',
                feature,
                enabled
            });
        });
    }

    async broadcastMessage(message) {
        const tabs = await chrome.tabs.query({
            url: 'https://open.spotify.com/*'
        });

        await Promise.all(
            tabs.map(tab =>
                chrome.tabs.sendMessage(tab.id, message)
            )
        );
    }

    startNowPlayingUpdates() {
        this.updateNowPlaying();

        this.updateInterval = setInterval(
            () => this.updateNowPlaying(),
            3000
        );
    }

    async updateNowPlaying() {
        try {
            const track =
                await this.spotifyAPI.getNowPlaying();

            if (!track) {
                return this.renderEmptyTrack();
            }

            this.state.currentTrack = track;

            this.renderTrack(track);

        } catch (error) {
            console.error(
                '[SpotOn] Now playing failed:',
                error
            );

            this.renderErrorTrack();
        }
    }

    renderTrack(track) {
        this.elements.albumArt.src =
            track.albumArt || 'assets/icon128.png';

        this.elements.trackTitle.textContent =
            track.title || 'Unknown title';

        this.elements.trackArtist.textContent =
            track.artist || 'Unknown artist';
    }

    renderEmptyTrack() {
        this.elements.albumArt.src =
            'assets/icon128.png';

        this.elements.trackTitle.textContent =
            'No track playing';

        this.elements.trackArtist.textContent =
            'Unknown artist';
    }

    renderErrorTrack() {
        this.elements.trackTitle.textContent =
            'Failed loading track';

        this.elements.trackArtist.textContent =
            'Try again';
    }

    setupQuickActions() {
        this.elements.copyInfo?.addEventListener(
            'click',
            () => this.copyTrackInfo()
        );

        this.elements.searchGenius?.addEventListener(
            'click',
            () => this.searchGenius()
        );
    }

    copyTrackInfo() {
        if (!this.state.currentTrack) {
            return;
        }

        navigator.clipboard.writeText(
            `${this.state.currentTrack.title} - ${this.state.currentTrack.artist}`
        );

        Toast.show('Track copied');
    }

    searchGenius() {
        if (!this.state.currentTrack) {
            return;
        }

        const query = encodeURIComponent(
            `${this.state.currentTrack.title} ${this.state.currentTrack.artist}`
        );

        window.open(
            `https://genius.com/search?q=${query}`
        );
    }

    setupImportExport() {
        this.elements.exportSettings?.addEventListener(
            'click',
            () => this.exportSettings()
        );
    }

    exportSettings() {
        chrome.storage.sync.get(null, settings => {
            downloadJSON(
                settings,
                'spoton-settings.json'
            );
        });
    }

    destroy() {
        clearInterval(this.updateInterval);
    }
}

const $ = (selector) =>
    document.querySelector(selector);

const Toast = {
    show(message) {
        const toast = document.createElement('div');

        toast.className = 'toast';

        toast.textContent = message;

        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }
};

function downloadJSON(data, filename) {
    const blob = new Blob(
        [JSON.stringify(data, null, 2)],
        { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');

    a.href = url;

    a.download = filename;

    a.click();

    URL.revokeObjectURL(url);
}

const popup = new PopupManager();

window.addEventListener('unload', () => {
    popup.destroy();
});
