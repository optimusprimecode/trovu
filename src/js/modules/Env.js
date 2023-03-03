/** @module Env */

import jsyaml from 'js-yaml';
import Helper from './Helper.js';
import UrlProcessor from './UrlProcessor.js';
import QueryParser from './QueryParser.js';

/** Set and remember the environment. */

export default class Env {
  /**
   * Set helper variables.
   */
  constructor() {
    this.configUrlTemplate =
      'https://raw.githubusercontent.com/{%github}/trovu-data-user/master/config.yml';
  }

  /**
   * Get the params from env.
   *
   * @return {object} - The built params.
   */
  getParams() {
    const params = {};

    // Put environment into hash.
    if (this.github) {
      params['github'] = this.github;
    } else {
      params['language'] = this.language;
      params['country'] = this.country;
    }
    if (this.debug) {
      params['debug'] = 1;
    }
    // Don't add defaultKeyword into params
    // when Github user is set.
    if (this.defaultKeyword && !this.github) {
      params['defaultKeyword'] = this.defaultKeyword;
    }
    if (this.status) {
      params['status'] = this.status;
    }
    if (this.query) {
      params['query'] = this.query;
    }
    if (this.alternative) {
      params['alternative'] = this.alternative;
    }
    if (this.key) {
      params['key'] = this.key;
    }

    return params;
  }

  /**
   * Get the parameters as string.
   */
  getParamStr() {
    const params = this.getParams();
    const paramStr = Helper.getUrlParamStr(params);
    return paramStr;
  }

  /**
   * Set the initial class environment vars either from params or from GET hash string.
   *
   * @param {array} params - List of parameters to be used in environment.
   */
  async populate(params) {
    if (!params) {
      params = Helper.getUrlParams();
    }

    if (typeof params.github === 'string' && params.github !== '') {
      await this.setWithUserConfigFromGithub(params);
    }

    Object.assign(this, params);
    Object.assign(this, QueryParser.parse(this.query));
    await this.setDefaults();

    if (this.extraNamespaceName) {
      this.namespaces.push(this.extraNamespaceName);
    }

    this.namespaceInfos = await this.getNamespaceInfos(
      this.namespaces,
      this.reload,
      this.debug,
    );
  }

  async getNamespaceInfos(namespaces, reload, debug) {
    const namespaceInfos = await this.fetchShortcuts(namespaces, reload, debug);
    await Object.values(namespaceInfos).forEach(async (namespaceInfo) => {
      namespaceInfo.shortcuts = await this.addIncludes(
        namespaceInfo.shortcuts,
        namespaceInfos,
      );
    });
    this.addReachable(namespaceInfos);
    return namespaceInfos;
  }

  getInitialNamespaceInfos(namespaces) {
    return Object.fromEntries(
      namespaces.map((namespace, index) => {
        const namespaceInfo = this.getInitalNamespaceInfo(namespace);
        namespaceInfo.priority = index + 1;
        return [namespaceInfo.name, namespaceInfo];
      }),
    );
  }

  /**
   * Set the user configuration from their fork in their Github profile.
   *
   * @param {array} params - Here, 'github' and 'debug' will be used
   */
  async setWithUserConfigFromGithub(params) {
    const config = await this.getUserConfigFromGithub(params);
    if (config) {
      Object.assign(this, config);
    }
  }

  /**
   * Get the user configuration from their fork in their Github profile.
   *
   * @param {array} params - Here, 'github' and 'debug' will be used
   *
   * @return {(object|boolean)} config - The user's config object, or false if fetch failed.
   */
  async getUserConfigFromGithub(params) {
    const configUrl = this.configUrlTemplate.replace(
      '{%github}',
      params.github,
    );
    const configYml = await Helper.fetchAsync(
      configUrl,
      params.reload,
      params.debug,
    );
    if (configYml) {
      try {
        const config = jsyaml.load(configYml);
        return config;
      } catch (error) {
        Helper.log('Error parsing ' + configUrl + ':\n\n' + error.message);
        this.error = true;
        return false;
      }
    } else {
      Helper.log('Failed to read Github config from ' + configUrl);
      this.error = true;
      return false;
    }
  }

  // Param getters ====================================================

  /**
   * Get the default language and country from browser.
   *
   * @return {object} [language, country] - The default language and country.
   */
  async getDefaultLanguageAndCountry() {
    let { language, country } = this.getLanguageAndCountryFromBrowser();

    if (!country) {
      country = await this.getCountryFromIP();
    }

    // Set defaults.
    language = language || 'en';
    country = country || 'us';

    // Ensure lowercase.
    language = language.toLowerCase();
    country = country.toLowerCase();

    return { language, country };
  }

  /**
   * Get the default language and country from browser.
   *
   * @return {object} [language, country] - The default language and country.
   */
  getLanguageAndCountryFromBrowser() {
    const languageStr = this.getNavigatorLanguage();
    let language, country;
    if (languageStr) {
      [language, country] = languageStr.split('-');
    }
    return { language, country };
  }

  /**
   * Wrapper for navigator language, capsuled to enable unit testing.
   *
   * @return {string} navigatorLanguage - The browser's value of navigator.language.
   */
  getNavigatorLanguage() {
    const languageStr = navigator.language;
    return languageStr;
  }

  /**
   * Get the country from the IP address.
   *
   * @return {string} country - The country as ISO 3166‑1 alpha-2 code
   */
  async getCountryFromIP() {
    const ipInfoUrl = 'https://api.db-ip.com/v2/free/self';
    const ipInfoText = await Helper.fetchAsync(ipInfoUrl, false);
    const ipInfo = JSON.parse(ipInfoText);
    const country = ipInfo.countryCode;
    return country;
  }

  /**
   * Set default environment variables if they are still empty.
   */
  async setDefaults() {
    let language, country;

    if (typeof this.language != 'string' || typeof this.country != 'string') {
      ({ language, country } = await this.getDefaultLanguageAndCountry());
    }

    // Default language.
    if (typeof this.language != 'string') {
      this.language = language;
    }
    // Default country.
    if (typeof this.country != 'string') {
      this.country = country;
    }
    // Default namespaces.
    if (typeof this.namespaces != 'object') {
      this.namespaces = ['o', this.language, '.' + this.country];
    }
    // Default debug.
    if (typeof this.debug != 'boolean') {
      this.debug = Boolean(this.debug);
    }
  }

  /**
   * Start fetching shortcuts per namespace.
   *
   * @param {array} namespaceInfos - The namespaces to fetch shortcuts for.
   * @param {boolean} reload   - Flag whether to call fetch() with reload. Otherwise, it will be called with 'force-cache'.
   *
   * @return {array} promises - The promises from the fetch() calls.
   */
  async startFetches(namespaceInfos, reload) {
    const promises = [];
    Object.values(namespaceInfos).forEach(async (namespaceInfo) => {
      if (!namespaceInfo.url) {
        // TODO: Handle this as error.
        return;
      }
      promises[namespaceInfo.priority] = fetch(namespaceInfo.url, {
        cache: reload ? 'reload' : 'force-cache',
      });
    });
    return promises;
  }

  /**
   * Add a fetch URL template to a namespace.
   *
   * @param {array} namespaceInfos - The namespaces to fetch shortcuts for.
   * @param {boolean} reload   - Flag whether to call fetch() with reload. Otherwise, it will be called with 'force-cache'.
   * @param {boolean} debug    - Flag whether to print debug messages.
   *
   * @return {array} namespaces - The namespaces with their fetched shortcuts, in a new property namespace.shortcuts.
   */
  async fetchShortcuts(namespaces, reload, debug) {
    const namespaceInfos = this.getInitialNamespaceInfos(namespaces);
    const promises = await this.startFetches(namespaceInfos, reload);

    // Wait until all fetch calls are done.
    const responses = await Promise.all(promises);

    for (const namespaceName in namespaceInfos) {
      const namespaceInfo = namespaceInfos[namespaceName];
      const response = responses[namespaceInfo.priority];
      if (!response || response.status != 200) {
        if (debug)
          Helper.log(
            (reload ? 'reload ' : 'cache  ') + 'Fail:    ' + namespaceInfo.url,
          );
        namespaceInfo.shortcuts = [];
        continue;
      }
      this.logSuccess(debug, reload, response);

      const text = await response.text();
      namespaceInfo.shortcuts = this.parseShortcutsFromYml(
        text,
        namespaceInfo.url,
      );

      namespaceInfo.shortcuts = this.verifyShortcuts(
        namespaceInfo.shortcuts,
        namespaceInfo.name,
      );
    }
    return namespaceInfos;
  }

  parseShortcutsFromYml(text, url) {
    try {
      const shortcuts = jsyaml.load(text);
      return shortcuts;
    } catch (error) {
      Helper.log('Error parsing ' + url + ':\n\n' + error.message);
      this.error = true;
      return [];
    }
  }

  logSuccess(debug, reload, response) {
    if (debug)
      Helper.log((reload ? 'reload ' : 'cache  ') + 'Success: ' + response.url);
    if (!debug) {
      Helper.log('.', false);
    }
  }

  /**
   * Add a fetch URL template to a namespace.
   *
   * @param {(string|Object)} namespace - The namespace to add the URL template to.
   *
   * @return {Object} namespace - The namespace with the added URL template.
   */
  getInitalNamespaceInfo(namespace) {
    // Site namespaces:
    if (typeof namespace == 'string' && namespace.length < 4) {
      namespace = this.addFetchUrlToSiteNamespace(namespace);
      return namespace;
    }
    // User namespace 1 – custom URL:
    if (namespace.url && namespace.name) {
      // Just add the type.
      namespace.type = 'user';
      return namespace;
    }
    // Now remains: User namespace 2 – Github:
    if (typeof namespace == 'string') {
      // Create an object.
      namespace = { github: namespace };
    }
    namespace = this.addFetchUrlToGithubNamespace(namespace);
    return namespace;
  }

  /**
   * Add a URL template to a namespace that refers to a namespace in trovu-data.
   *
   * @param {string} name - The namespace name.
   *
   * @return {Object} namespace - The namespace with the added URL template.
   */
  addFetchUrlToSiteNamespace(name) {
    const namespace = {
      name: name,
      type: 'site',
      url: 'https://data.trovu.net/data/shortcuts/' + name + '.yml',
    };
    return namespace;
  }

  /**
   * Add a URL template to a namespace that refers to a Github user repo.
   *
   * @param {string} name - The namespace name.
   *
   * @return {Object} namespace - The namespace with the added URL template.
   */
  addFetchUrlToGithubNamespace(namespace) {
    if (namespace.github == '.') {
      // Set to current user.
      namespace.github = this.github;
    }
    // Default name to Github name.
    if (!namespace.name) {
      namespace.name = namespace.github;
    }
    namespace.url =
      'https://raw.githubusercontent.com/' +
      namespace.github +
      '/trovu-data-user/master/shortcuts.yml';
    namespace.type = 'user';
    return namespace;
  }

  /**
   * Ensure shortcuts have the correct structure.
   *
   * @param {array} shortcuts      - The shortcuts to normalize.
   * @param {string} namespaceName - The namespace name to show in error message.
   *
   * @return {array} shortcuts - The normalized shortcuts.
   */
  verifyShortcuts(shortcuts, namespaceName) {
    const incorrectKeys = [];
    for (const key in shortcuts) {
      if (!key.match(/\S+ \d/)) {
        incorrectKeys.push(key);
      }
      // Check for 'only URL' (string) shortcuts
      // and make an object of them.
      if (typeof shortcuts[key] === 'string') {
        const url = shortcuts[key];
        shortcuts[key] = {
          url: url,
        };
      }
    }
    if (incorrectKeys.length > 0) {
      Helper.log(
        "Incorrect keys found in namespace '" +
          namespaceName +
          "'. Keys must have the form 'KEYWORD ARGCOUNT', e.g.: 'foo 0'" +
          '\n\n' +
          incorrectKeys.join('\n'),
      );
      this.error = true;
    }
    return shortcuts;
  }

  async addIncludes(shortcuts, namespaceInfos) {
    for (const key in shortcuts) {
      let shortcut = shortcuts[key];
      if (shortcut.include) {
        if (shortcut.include.key) {
          if (shortcut.include.namespace) {
            // TODO: Handle include with namespace.
            const shortcutToInclude = await this.getShortcutFromNamespace(
              shortcut.include.key,
              shortcut.include.namespace,
              namespaceInfos,
            );
            shortcut = Object.assign(shortcut, shortcutToInclude);
          } else {
            const shortcutToInclude = shortcuts[shortcut.include.key];
            shortcut = Object.assign(shortcut, shortcutToInclude);
          }
        } else {
          Helper.log(`Incorrect include found at ${key}`);
          this.error = true;
          continue;
        }
      }
    }
    return shortcuts;
  }

  async getShortcutFromNamespace(key, namespaceName, namespaceInfos) {
    if (!namespaceInfos[namespaceName]) {
      const newNamespaceInfos = await this.fetchShortcuts(
        [namespaceName],
        this.reload, // TODO: Handle debug and reload params properly.
        this.debug, // TODO: Handle debug and reload params properly.
      );
      Object.assign(namespaceInfos, newNamespaceInfos);
    }
    const shortcut = namespaceInfos[namespaceName].shortcuts[key];
    return shortcut;
  }

  /**
   * Enrich shortcuts with their own information: argument & namespace names, reachable.
   *
   * @param {object} namespaces - Current namespaces keyed by their name.
   */
  addReachable(namespaceInfos) {
    const namespaceInfosByPriority = Object.values(namespaceInfos).sort(
      (a, b) => {
        return b.priority - a.priority;
      },
    );

    // Remember found shortcuts
    // to know which ones are reachable.
    const foundShortcuts = {};

    // Iterate over namespaces in reverse order.
    // Slice to keep original.
    for (const namespaceInfo of namespaceInfosByPriority) {
      if (!this.isSubscribed(namespaceInfo)) {
        continue;
      }
      const shortcuts = namespaceInfo.shortcuts;

      for (const key in shortcuts) {
        let shortcut = shortcuts[key];

        shortcut = this.addInfoToShortcut(shortcut, key, namespaceInfo);

        // If not yet present: reachable.
        // (Because we started with most precendent namespace.)
        if (!(key in foundShortcuts)) {
          shortcut.reachable = true;
        }
        // Others are unreachable
        // but can be reached with namespace forcing.
        else {
          shortcut.reachable = false;
        }

        shortcuts[key] = shortcut;
        foundShortcuts[key] = true;
      }
    }
    return namespaceInfos;
  }

  addInfoToShortcut(shortcut, key, namespaceInfo) {
    shortcut.key = key;
    [shortcut.keyword, shortcut.argumentCount] = key.split(' ');
    shortcut.namespace = namespaceInfo.name;
    shortcut.arguments = UrlProcessor.getArgumentsFromString(shortcut.url);
    shortcut.title = shortcut.title || '';
    return shortcut;
  }

  /**
   * Check if namespace is subscribed to.
   *
   * @param {object} namespaceInfo - namespace to be checked.
   *
   * @return {boolean} isSubscribed - TRUE if subscribed.
   */
  isSubscribed(namespaceInfo) {
    return namespaceInfo.priority && namespaceInfo.priority > 0;
  }
}
