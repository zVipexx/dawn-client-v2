(function () {
  if (window.self !== window.top) return;
  if (window.__DAWN_INITIALIZED__) return;
  window.__DAWN_INITIALIZED__ = true;

  (function () {
    const originalOpen = window.open;
    window.open = function (url, target, features) {
      if (url && (url.startsWith('http') || url.startsWith('https') || url.startsWith('mailto:'))) {
        if (window.__TAURI__ && window.__TAURI__.core) {
          window.__TAURI__.core.invoke("plugin:opener|open_url", { url: url })
            .catch(err => console.error("Failed to open URL:", err));

          return {
            focus: () => { },
            close: () => { },
            blur: () => { },
            closed: false,
            opener: window,
          };
        }
      }
      return originalOpen.apply(window, arguments);
    };
  })();

  const allowDropGlobal = (e) => {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  window.addEventListener("dragenter", allowDropGlobal, true);
  window.addEventListener("dragover", allowDropGlobal, true);
  document.addEventListener("dragenter", allowDropGlobal, true);
  document.addEventListener("dragover", allowDropGlobal, true);

  let lastHoveredArea = null;

  const setupTauriListeners = () => {
    if (window.__TAURI__ && window.__TAURI__.event) {
      window.__TAURI__.event.listen("tauri://drag-over", (event) => {
        const { position } = event.payload;
        const scale = window.devicePixelRatio || 1;
        const x = position.x / scale;
        const y = position.y / scale;
        const target = document.elementFromPoint(x, y);

        const currentArea = target ? target.closest(".upload-area") : null;

        if (currentArea !== lastHoveredArea) {
          if (lastHoveredArea) lastHoveredArea.classList.remove("drag-over");
          if (currentArea) currentArea.classList.add("drag-over");
          lastHoveredArea = currentArea;
        }
      });

      window.__TAURI__.event.listen("tauri://drag-leave", () => {
        if (lastHoveredArea) {
          lastHoveredArea.classList.remove("drag-over");
          lastHoveredArea = null;
        }
      });

      window.__TAURI__.event.listen("tauri://drag-drop", async (event) => {
        if (lastHoveredArea) {
          lastHoveredArea.classList.remove("drag-over");
          lastHoveredArea = null;
        }

        const { paths, position } = event.payload;
        if (!paths || paths.length === 0) return;

        const scale = window.devicePixelRatio || 1;
        const x = position.x / scale;
        const y = position.y / scale;
        const target = document.elementFromPoint(x, y);

        if (!target) return;

        const skinArea = target.closest("#skin-upload-area");
        const soundArea = target.closest("#sound-upload-area");

        if (skinArea) {
          handleNativeFile(paths[0], "skin");
        } else if (soundArea) {
          handleNativeFile(paths[0], "sound");
        }
      });
      return true;
    }
    return false;
  };

  const handleNativeFile = async (filePath, type) => {
    try {
      const data = await window.__TAURI__.core.invoke("read_file_binary", { path: filePath });
      const uint8Array = new Uint8Array(data);
      const blob = new Blob([uint8Array]);
      const file = new File([blob], filePath.split(/[\\/]/).pop(), { type: type === "skin" ? "image/webp" : "audio/mpeg" });

      if (type === "skin") {
        if (typeof window.__handleSkinFile === "function") {
          window.__handleSkinFile(file);
        }
      } else {
        if (typeof window.__handleSoundFile === "function") {
          window.__handleSoundFile(file);
        }
      }
    } catch (err) {
      console.error("Failed to handle native file drop:", err);
    }
  };

  if (!setupTauriListeners()) {
    const tauriCheckInterval = setInterval(() => {
      if (setupTauriListeners()) clearInterval(tauriCheckInterval);
    }, 500);
    setTimeout(() => clearInterval(tauriCheckInterval), 10000);
  }

  let isFpsOverlayActive = false;
  let fpsEl = null;
  let lastFPSUpdate = 0;

  (function () {
    const originalRAF = window.requestAnimationFrame;
    const callbacks = new Set();

    let frameTimes = [];
    const maxFrames = 60;
    const addFpsEl = () => {
      if (fpsEl && fpsEl.isConnected) return fpsEl;

      const overlay = document.querySelector("#overlay");
      if (!overlay) return null;

      const fpsElDiv = document.createElement("div");
      const children = overlay.children;
      overlay.insertBefore(fpsElDiv, children[3] || null);

      fpsEl = document.createElement("span");
      fpsEl.id = "theoreticalfps";
      fpsElDiv.appendChild(fpsEl);

      return fpsEl;
    };

    const runCallbacks = (timestamp) => {
      if (callbacks.size === 0) return;
      const cbs = Array.from(callbacks);
      callbacks.clear();
      for (const cb of cbs) {
        try { cb(timestamp); } catch (e) {
          if (!e || !e.message || !e.message.includes("Cannot read properties of null (reading 'time')")) {
            console.error(e);
          }
        }
      }
    };

    let lastFrameTime = performance.now();

    const loop = (timestamp) => {
      const now = performance.now();
      if (isFpsOverlayActive) {
        const start = now;

        runCallbacks(timestamp);

        const end = performance.now();
        const duration = end - start;

        if (duration > 0.1) {
          const potential = 1000 / duration;
          frameTimes.push(potential);
          if (frameTimes.length > maxFrames) frameTimes.shift();

          const avgPotential = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;

          if (now - lastFPSUpdate > 1000) {
            const el = addFpsEl();
            if (el) {
              el.textContent = `FPS MAX: ${avgPotential.toFixed(2)}`;
              lastFPSUpdate = now;
            }
          }
        }
      } else {
        runCallbacks(timestamp);

        const delta = now - lastFrameTime;
        if (delta > 0) {
          const fps = 1000 / delta;
          frameTimes.push(fps);
          if (frameTimes.length > maxFrames) frameTimes.shift();
        }

        if (fpsEl && fpsEl.isConnected) {
          const wrapper = fpsEl.parentElement;
          if (wrapper) wrapper.remove();
          fpsEl = null;
        }
      }
      lastFrameTime = now;
      originalRAF(loop);
    };

    window.requestAnimationFrame = function (callback) {
      callbacks.add(callback);
      return 1;
    };

    originalRAF(loop);
  })();

  (function initSwapper() {
    if (typeof DAWNSWAP_DATA === "undefined" || typeof DAWNSWAP_DATA !== "object") return;
    const swapData = DAWNSWAP_DATA;

    const getSwappedUrl = (url) => {
      if (!url) return url;
      try {
        const fullUrl = new URL(url, window.location.href).href;
        const normalized = fullUrl
          .replace("www.kirka.io", "kirka.io")
          .replace(/_/g, "")
          .split("?")[0]
          .split("#")[0];

        if (swapData[normalized]) {
          return swapData[normalized];
        }
      } catch (e) { }
      return url;
    };

    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      if (typeof input === "string") {
        input = getSwappedUrl(input);
      } else if (input instanceof URL) {
        const swapped = getSwappedUrl(input.href);
        if (swapped !== input.href) {
          input = new URL(swapped);
        }
      }
      return originalFetch.call(this, input, init);
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      const swappedUrl = getSwappedUrl(url);
      return originalOpen.apply(this, [method, swappedUrl, ...Array.prototype.slice.call(arguments, 2)]);
    };

    const originalImageSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      get: function () {
        return originalImageSrcDescriptor.get.call(this);
      },
      set: function (value) {
        const swapped = getSwappedUrl(value);
        originalImageSrcDescriptor.set.call(this, swapped);
      },
      configurable: true,
      enumerable: true
    });

    const originalSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if ((this.tagName === "IMG" || this.tagName === "SOURCE") && (name === "src" || name === "srcset")) {
        value = getSwappedUrl(value);
      }
      return originalSetAttribute.call(this, name, value);
    };
  })();

  function init() {
    if (document.getElementById("dawn-menu")) return;

    const DEFAULTS = {
      menu_theme: "dark",
      menu_color: "#6366f1",
      css_enabled: false,
      css_link: "",
      advanced_css: "",
      perm_tablist: false,
      hide_chat: false,
      hide_kill_text: false,
      hide_interface: false,
      skip_loading: false,
      ui_animations: true,
      lobby_keybind_reminder: true,
      spectate_button: true,
      customizations: true,
      animations: true,
      colored_killfeed: true,
      display_kd: true,
      show_trade_buttons: true,
      chat_height: 0,
      interface_opacity: 100,
      interface_bounds: "normal",
      hitmarker_link: "",
      killicon_link: "",
      rave_mode: false,
      fullscreen_enabled: true,
      discord_rpc: true,
      menu_keybind: "ShiftRight",
      local_customs_enabled: false,
      local_gradient_animated: false,
      local_gradient_rot: 90,
      local_gradient_blur: 20,
      accept_on_click: false
    };

    let selectedTradeId = null;

    function scanForFileInputs(container) {
      const inputs = container.querySelectorAll("input, textarea");
      inputs.forEach(input => {
        if (input.dataset.Observed) return;
        input.dataset.Observed = "true";

        const update = () => checkInputForFile(input);

        update();
        input.addEventListener("input", update);
        input.addEventListener("change", update);
      });
    }

    function checkInputForFile(input) {
      const val = input.value;
      const isLocalPath = val.trim() !== "" && (/^[a-zA-Z]:\\/.test(val) || val.startsWith("file://") || (val.startsWith("/") && !val.startsWith("/games")));

      let warningIcon = input.parentNode.querySelector(".dawn-file-warning");

      if (isLocalPath) {
        if (!warningIcon) {
          warningIcon = document.createElement("div");
          warningIcon.className = "dawn-file-warning";
          warningIcon.innerHTML = "⚠️";
          warningIcon.title = "Due to tauri restrictions local resources cannot be loaded. Click here to convert to BASE64";
          warningIcon.style.cssText = "cursor: pointer; margin-right: 8px; margin-left: -30px; font-size: 16px;";

          input.parentNode.style.display = "flex";
          input.parentNode.style.alignItems = "center";
          input.parentNode.style.flexDirection = "row";
          input.parentNode.insertBefore(warningIcon, input);

          warningIcon.addEventListener("click", () => convertInputPath(input, warningIcon));
        }
        warningIcon.style.display = "flex";
      } else if (warningIcon) {
        warningIcon.style.display = "none";
      }
    }

    function convertInputPath(input, icon) {
      const path = input.value.replace(/^file:\/\/\//, "").replace(/^file:\/\//, "");
      icon.innerHTML = "⏳";
      window.__TAURI__.core.invoke("convert_file_to_base64", { path: path })
        .then(base64 => {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          nativeInputValueSetter.call(input, base64);

          ["input", "change", "blur"].forEach(ev => input.dispatchEvent(new Event(ev, { bubbles: true })));

          input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, which: 37, bubbles: true }));
          input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, which: 37, bubbles: true }));

          icon.innerHTML = "✅";
          icon.classList.add("success");
          setTimeout(() => {
            icon.innerHTML = "⚠️";
            icon.style.display = "none";
            icon.classList.remove("success");
          }, 2000);
        })
        .catch(err => {
          console.error("Conversion Failed", err);
          icon.innerHTML = "❌";
          icon.title = "Conversion Failed: " + err;
          icon.classList.add("failed");
          setTimeout(() => {
            icon.innerHTML = "⚠️";
            icon.style.display = "none";
            icon.classList.remove("failed");
          }, 2000);
        });
    }

    const container = document.createElement("div");
    const htmlContent = (typeof INJECTED_MENU_HTML !== "undefined") ? INJECTED_MENU_HTML : '<div style="color:red">Menu Injection Failed</div>';
    const cssContent = (typeof INJECTED_MENU_CSS !== "undefined") ? INJECTED_MENU_CSS : "";

    container.innerHTML = htmlContent;
    if (cssContent) {
      const style = document.createElement("style");
      style.id = "dawn-custom-styles-base";
      style.textContent = cssContent;
      document.head.appendChild(style);
    }

    document.body.appendChild(container.querySelector("#dawn-menu"));

    if (!document.querySelector('link[href*="font-awesome"]')) {
      const fontAwesome = document.createElement("link");
      fontAwesome.rel = "stylesheet";
      fontAwesome.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
      if (document.head) {
        document.head.appendChild(fontAwesome);
      } else {
        const headObs = new MutationObserver(() => {
          if (document.head) {
            document.head.appendChild(fontAwesome);
            headObs.disconnect();
          }
        });
        headObs.observe(document.documentElement, { childList: true });
      }
    }

    if (!document.getElementById("dawn-custom-styles")) {
      const userStyle = document.createElement("style");
      userStyle.id = "dawn-custom-styles";
      document.head.appendChild(userStyle);
    }

    const menu = document.getElementById("dawn-menu");
    const header = menu.querySelector(".menu-header");
    const styleTag = document.getElementById("dawn-custom-styles");

    if (typeof DAWN_ICON !== "undefined") {
      const iconEl = document.getElementById("dawn-about-icon");
      if (iconEl) iconEl.src = DAWN_ICON;
    }
    if (typeof DAWN_VERSION !== "undefined") {
      const versionText = `v${DAWN_VERSION}`;
      const aboutVersionEl = document.getElementById("dawn-about-version");
      if (aboutVersionEl) aboutVersionEl.textContent = versionText;
      const headerVersionEl = document.getElementById("dawn-header-version");
      if (headerVersionEl) headerVersionEl.textContent = versionText;
    }

    if (!document.getElementById("dawn-external-styles")) {
      const externalLink = document.createElement("link");
      externalLink.id = "dawn-external-styles";
      externalLink.rel = "stylesheet";
      document.head.appendChild(externalLink);
    }
    const linkTag = document.getElementById("dawn-external-styles");

    let menuKeybind = "ShiftRight";
    let isRecordingKeybind = false;

    const tabs = menu.querySelectorAll(".tab");
    const optionGroups = menu.querySelectorAll(".options");

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const targetTab = tab.getAttribute("data-tab");

        localStorage.setItem("dawn-active-tab", targetTab);

        tabs.forEach(t => t.classList.remove("active"));
        tab.classList.add("active");

        optionGroups.forEach(group => {
          if (group.id === `${targetTab}-options`) {
            group.classList.add("active");
          } else {
            group.classList.remove("active");
          }
        });
      });
    });

    const savedTab = localStorage.getItem("dawn-active-tab");
    if (savedTab) {
      const tabToClick = Array.from(tabs).find(t => t.getAttribute("data-tab") === savedTab);
      if (tabToClick) tabToClick.click();
    }

    const loadSettings = () => {
      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");

      const keybindBtn = document.getElementById("menu_keybind_btn");
      if (keybindBtn) {
        const savedBind = settings["menu_keybind"] || DEFAULTS.menu_keybind;
        keybindBtn.innerText = savedBind === "ShiftRight" ? "Right Shift" : savedBind;
        menuKeybind = savedBind;
      }

      menu.querySelectorAll("[data-setting]").forEach(el => {
        const key = el.getAttribute("data-setting");
        const val = settings[key] !== undefined ? settings[key] : DEFAULTS[key];

        if (el.type === "checkbox") {
          el.checked = !!val;
        } else {
          el.value = val ?? "";
        }
      });

      updateCSS();
      updateTheme();
      updateUIFeatures();
    };

    const formatLink = (url) => {
      if (!url) return "";
      if (url.startsWith("http") || url.startsWith("data:")) return url;
      return url;
    };

    const updateUIFeatures = () => {
      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      const styles = [];

      let addedStyles = document.getElementById("dawn-ui-features");
      if (!addedStyles) {
        addedStyles = document.createElement("style");
        addedStyles.id = "dawn-ui-features";
        document.head.appendChild(addedStyles);
      }

      if (settings.perm_tablist)
        styles.push(
          ".tab-info, .tab-team-info { display: flex !important; border-radius: 0.5rem !important; max-width: 30rem !important; top: 0 !important; right: 0 !important; position: absolute; margin: 0.5rem !important; padding: 0.15rem !important; width: 35rem !important; }",
          ".tab-team-info .players-cont { flex-direction: column !important; }",
          ".tab-info .player-list, .tab-team-info .player-list { margin: unset !important; gap: 0.25rem; }",
          ".tab-info > .head, .tab-team-info > .head { display: none; }",
          '.tab-team-info .player-list:nth-child(1)::before { content: "RED"; width: 100%; text-align: left; padding: 0.25rem 0.5rem; font-size: 1.25rem; background-color: #ff4d42; border-radius: 0.25rem; box-sizing: border-box; }',
          '.tab-team-info .player-list:nth-child(2)::before { content: "BLUE"; width: 100%; text-align: left; padding: 0.25rem 0.5rem; font-size: 1.25rem; background-color: #0d6dc6; border-radius: 0.25rem; box-sizing: border-box; margin-top: 0.5rem; }',
          ".players-wrap .list { display: none !important; }",
          ".tab-info .list, .tab-team-info .player-list > .list { order: 999; }",
          ".tab-info .players-wrap, .tab-team-info .players-wrap { padding: 0.25rem; }",
          ".tab-info .player-cont, .tab-team-info .player-cont { margin: unset; }",
          ".kill-bar-cont { right: 37.5rem !important; }",
          ".tab-info { background: #141414a3 !important; border-radius: 0.25rem !important; max-width: 35rem !important; }",
          ".tab-info .head { background: linear-gradient(90deg, #ff932d, transparent) !important; border: unset; font-style: normal; border-top-left-radius: 0.25rem; }",
          ".tab-info .head .server-id { display: none; }",
          ".tab-info .list-value { color: #acfa70; }",
          ".tab-team-info { background: #141414a3 !important; border-radius: 0.25rem !important; max-width: 60rem !important; }",
          ".tab-team-info .head { background: transparent !important; }",
          ".tab-team-info .label.red { border-top-left-radius: 0.25rem; background: linear-gradient(90deg, #ff4c4c, #141414a3); justify-content: flex-start; padding-left: 0.75rem; }",
          ".tab-team-info .label.blue { border-top-right-radius: 0.25rem; background: linear-gradient(-90deg, #4476ff, #141414a3); justify-content: flex-end; padding-right: 0.75rem; }",
          ".player-list .list-value { color: #acfa70; }",
          ".player-list .player-cont { background: #141414a3 !important; border-radius: 0.25rem; padding: 0.25rem; }",
          ".player-cont .nickname.bolder { color: #edb846; }"
        );
      if (settings.hide_chat)
        styles.push(
          ".desktop-game-interface > #bottom-left > .chat { display: none !important; }"
        );
      if (settings.hide_kill_text)
        styles.push(
          ".ach-cont .text { display: none !important; }"
        );
      if (settings.hide_interface)
        styles.push(
          ".desktop-game-interface, .crosshair-cont, .ach-cont, .hitme-cont, .sniper-mwNMW-cont, .team-score, .score { display: none !important; }"
        );
      if (settings.skip_loading)
        styles.push(".loading-scene { display: none !important; }");
      if (settings.chat_height && settings.chat_height != 0) {
        styles.push(`.desktop-game-interface #chat { bottom: calc(4.7em + ${settings.chat_height}em * 1.2) !important } .desktop-game-interface #chat .messages { min-height: calc(11.75em + ${settings.chat_height}em) !important }`)
      }
      if (settings.interface_opacity !== "100" && settings.interface_opacity !== 100)
        styles.push(
          `.desktop-game-interface { opacity: ${settings.interface_opacity}% !important; }`
        );
      if (settings.interface_bounds) {
        let scale =
          settings.interface_bounds === "1"
            ? 0.9
            : settings.interface_bounds === "0"
              ? 0.8
              : 1;
        if (scale !== 1) styles.push(
          `.desktop-game-interface { transform: scale(${scale}) !important; }`
        );
      }
      if (settings.hitmarker_link)
        styles.push(
          `.hitmark { content: url(${formatLink(
            settings.hitmarker_link
          )}) !important; }`
        );
      if (settings.killicon_link)
        styles.push(`.animate-cont::before { content: ""; 
      background: url(${formatLink(
          settings.killicon_link
        )}); width: 10rem; height: 10rem; margin-bottom: 2rem; display: inline-block; background-position: center; background-size: contain; background-repeat: no-repeat; }
      .animate-cont svg { display: none; }`);
      if (settings.ui_animations === false)
        styles.push(
          "* { transition: none !important; animation: none !important; }"
        );
      if (settings.rave_mode)
        styles.push(
          "canvas { animation: rotateHue 1s linear infinite !important; } @keyframes rotateHue { 0% { filter: hue-rotate(0deg); } 100% { filter: hue-rotate(360deg); } }"
        );
      if (settings.lobby_keybind_reminder === false)
        styles.push("#juice-keybind-reminder { display: none; }");
      if (settings.spectate_button === false)
        styles.push(".spectate-eye { display: none !important; }");

      addedStyles.innerHTML = styles.join(" ");
    };

    const hexToRgb = (hex) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : null;
    };

    const updateTheme = () => {
      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      const theme = settings["menu_theme"] || "dark";
      const color = settings["menu_color"] || "#6366f1";

      menu.setAttribute("data-theme", theme);

      const rgb = hexToRgb(color);
      if (rgb) {
        menu.style.setProperty("--accent", rgb);
      } else {
        menu.style.removeProperty("--accent");
      }
    };

    const saveSettings = (e) => {
      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");

      menu.querySelectorAll("[data-setting]").forEach(el => {
        const key = el.getAttribute("data-setting");
        settings[key] = el.type === "checkbox" ? el.checked : el.value;
      });

      localStorage.setItem("dawn-settings", JSON.stringify(settings));

      document.dispatchEvent(new CustomEvent("dawn-settings-changed", {
        detail: { settings }
      }));

      updateCSS();
      updateTheme();
      updateUIFeatures();

      if (e && e.target) {
        const changedKey = e.target.getAttribute("data-setting");

        if (changedKey === "advanced_css") {
          window.__TAURI__.core.invoke("save_css", { css: e.target.value })
            .catch(err => console.error("Failed to save CSS:", err));
        }

        if (changedKey === "fullscreen_enabled") {
          window.__TAURI__.core.invoke("toggle_fullscreen")
            .catch(err => console.error("Failed to toggle fullscreen:", err));
        }

        if (changedKey === "discord_rpc") {
          window.__TAURI__.core.invoke("toggle_discord_rpc", { enabled: e.target.checked })
            .catch(err => console.error("Failed to toggle Discord RPC:", err));
        }

        if (e.target.type === "checkbox" || e.target.type === "range") {
          e.target.blur();
        }
      }
    };

    const updateCSS = () => {
      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      const enabled = settings["css_enabled"] !== false;
      const cssContent = settings["advanced_css"] || "";
      const cssLink = settings["css_link"] || "";

      if (enabled) {
        styleTag.textContent = cssContent;
        if (cssLink) {
          linkTag.href = cssLink;
        } else {
          linkTag.removeAttribute("href");
        }
      } else {
        styleTag.textContent = "";
        linkTag.removeAttribute("href");
      }
    };

    menu.querySelectorAll("[data-setting]").forEach(el => {
      const eventType = el.type === "checkbox" ? "change" : "input";
      el.addEventListener(eventType, saveSettings);
    });

    const searchInput = menu.querySelector(".menu-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase().trim();
        const options = menu.querySelectorAll(".option");

        options.forEach(opt => {
          const text = opt.querySelector("span")?.textContent.toLowerCase() || "";
          if (text.includes(query)) {
            opt.style.display = "flex";
          } else {
            opt.style.display = "none";
          }
        });

      });
    }

    menu.querySelectorAll(".option.dropdown .top").forEach(dropdownTop => {
      dropdownTop.addEventListener("click", () => {
        dropdownTop.parentElement.classList.toggle("open");
      });
    });

    loadSettings();

    const initManagement = (menu) => {
      const openSwapperBtn = menu.querySelector("#open-swapper-btn");
      const openScriptsBtn = menu.querySelector("#open-scripts-btn");
      const resetBtn = menu.querySelector("#reset-settings-btn");

      if (openSwapperBtn) {
        openSwapperBtn.addEventListener("click", () => {
          window.__TAURI__.core.invoke("open_swapper_folder", { folderType: "base" })
            .catch(err => console.error("Failed to open swapper folder:", err));
        });
      }

      if (openScriptsBtn) {
        openScriptsBtn.addEventListener("click", () => {
          window.__TAURI__.core.invoke("open_scripts_folder")
            .catch(err => console.error("Failed to open scripts folder:", err));
        });
      }

      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          if (confirm("Are you sure you want to reset your Dawn Client settings to default? This action cannot be undone.")) {
            localStorage.setItem("dawn-settings", JSON.stringify(DEFAULTS));
            window.location.reload();
          }
        });
      }
    };

    scanForFileInputs(menu);
    initChestOpener(menu);
    initManagement(menu);

    const keybindBtn = document.getElementById("menu_keybind_btn");
    if (keybindBtn) {
      keybindBtn.addEventListener("click", () => {
        isRecordingKeybind = true;
        keybindBtn.innerText = "Press any key...";
      });
    }

    window.addEventListener("keydown", (e) => {
      const active = document.activeElement;
      const isTextInput = active && (
        active.tagName === "TEXTAREA" ||
        active.isContentEditable ||
        (active.tagName === "INPUT" && ["text", "password", "number", "email", "url", "search"].includes(active.type))
      );

      if (isTextInput && !isRecordingKeybind) return;

      if (isRecordingKeybind) {
        e.preventDefault();
        e.stopPropagation();
        isRecordingKeybind = false;

        let code = e.code;

        menuKeybind = code;
        const display = code === "ShiftRight" ? "Right Shift" : code;
        if (keybindBtn) keybindBtn.innerText = display;

        const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
        settings["menu_keybind"] = menuKeybind;
        localStorage.setItem("dawn-settings", JSON.stringify(settings));

        document.dispatchEvent(new CustomEvent("juice-settings-changed", {
          detail: { setting: "menu_keybind", value: display }
        }));

        return;
      }

      if (e.code === menuKeybind) {
        e.preventDefault();
        menu.style.display = menu.style.display === "none" ? "flex" : "none";
      }
    });

    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    const savedPos = JSON.parse(localStorage.getItem("dawn-menu-pos") || '{"x": 0, "y": 0}');
    let xOffset = savedPos.x;
    let yOffset = savedPos.y;

    setTranslate(xOffset, yOffset, menu);

    header.addEventListener("mousedown", dragStart);
    document.addEventListener("mousemove", drag);
    document.addEventListener("mouseup", dragEnd);

    function dragStart(e) {
      initialX = e.clientX - xOffset;
      initialY = e.clientY - yOffset;
      if (e.target === header || header.contains(e.target)) {
        isDragging = true;
        menu.classList.add("dragging");
      }
    }

    function drag(e) {
      if (isDragging) {
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;

        xOffset = currentX;
        yOffset = currentY;

        setTranslate(currentX, currentY, menu);
      }
    }

    function setTranslate(xPos, yPos, el) {
      el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
    }

    function dragEnd(e) {
      if (!isDragging) return;

      initialX = currentX;
      initialY = currentY;
      isDragging = false;
      menu.classList.remove("dragging");

      localStorage.setItem("dawn-menu-pos", JSON.stringify({ x: xOffset, y: yOffset }));
    }

    window.addEventListener("keydown", (e) => {
      if (e.altKey && e.code === "F4") {
        e.preventDefault();
        window.__TAURI__.core.invoke("exit_app");
      }

      if (e.code === "F5") {
        window.location.reload();
      }

      if (e.code === "F6") {
        const url = prompt("Enter URL to load:", "https://kirka.io");
        if (url) {
          window.location.href = url.startsWith("http") ? url : `https://${url}`;
        }
      }

      if (e.code === "F11") {
        e.preventDefault();
        window.__TAURI__.core.invoke("toggle_fullscreen")
      }

      if (e.code === "F12") {
        e.preventDefault();
        window.__TAURI__.core.invoke("open_devtools")
      }

      if (e.code === "Escape") {
        if (menu.style.display !== "none") {
          menu.style.display = "none";
        }
      }
    });


    const setupSettingsObserver = () => {
      const observer = new MutationObserver((mutations) => {
        const settingsModal = document.querySelector(".vm--container .settings");
        if (settingsModal) {
          scanForFileInputs(settingsModal);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      const existingSettings = document.querySelector(".settings");
      if (existingSettings) scanForFileInputs(existingSettings);
    };

    setupSettingsObserver();

  }

  const initDiscordRPC = () => {
    let lastState = "";

    const updateRPC = () => {
      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      if (settings.discord_rpc === false) return;

      const path = window.location.pathname;
      let state = "In the lobby";

      const pathMap = {
        "/": "In the lobby",
        "/hub/leaderboard": "Viewing the leaderboard",
        "/hub/clans/champions-league": "Viewing the clan leaderboard",
        "/hub/clans/my-clan": "Viewing their clan",
        "/hub/market": "Viewing the market",
        "/hub/live": "Viewing videos",
        "/hub/news": "Viewing news",
        "/hub/terms": "Viewing the terms of service",
        "/store": "Viewing the store",
        "/servers/main": "Viewing main servers",
        "/servers/parkour": "Viewing parkour servers",
        "/servers/custom": "Viewing custom servers",
        "/quests/hourly": "Viewing hourly quests",
        "/friends": "Viewing friends",
        "/inventory": "Viewing their inventory",
      };

      if (pathMap[path]) {
        state = pathMap[path];
      } else if (path.startsWith("/games/")) {
        state = "In a match";
      } else if (path.startsWith("/profile/")) {
        state = "Viewing a profile";
      }

      if (state !== lastState) {
        lastState = state;
        window.__TAURI__.core.invoke("set_discord_rpc_activity", { activityState: state })
          .catch(err => console.error("Failed to update Discord RPC:", err));
      }
    };

    setInterval(updateRPC, 5000);
    updateRPC();
  };

  const initGallery = () => {
    const galleryContent = document.getElementById("gallery-content");
    const refreshBtn = document.getElementById("gallery-refresh");

    if (!galleryContent) return;

    const showConfirmation = (btn, originalIcon) => {
      btn.innerHTML = '<i class="fas fa-check" style="color: #4ade80;"></i>';
      setTimeout(() => { btn.innerHTML = originalIcon; }, 1500);
    };

    const loadGallery = async (silent = false) => {
      if (!silent) galleryContent.innerHTML = '<div class="gallery-loading">Loading gallery...</div>';

      try {
        const categories = await window.__TAURI__.core.invoke("get_gallery");

        if (!categories || categories.length === 0) {
          galleryContent.innerHTML = '<div class="gallery-empty">No categories found.<br>Create folders in Documents/DawnClient/gallery/ to add categories.</div>';
          return;
        }

        galleryContent.innerHTML = "";

        categories.forEach(category => {
          const categoryEl = document.createElement("div");
          categoryEl.className = "gallery-category";

          const header = document.createElement("div");
          header.className = "gallery-category-header";
          header.innerHTML = `
            <div class="gallery-category-name">
              <i class="fas fa-folder"></i>
              <span>${category.name.toUpperCase()}</span>
              <span style="opacity: 0.5; font-size: 0.8rem;">(${category.files.length} files)</span>
            </div>
            <div class="gallery-category-actions">
              <button class="juice-button open-folder" title="Open Folder">
                <i class="fas fa-folder-open"></i>
              </button>
            </div>
          `;

          const categoryOpenBtn = header.querySelector(".open-folder");
          categoryOpenBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.__TAURI__.core.invoke("open_gallery_folder", { path: category.path });
            showConfirmation(categoryOpenBtn, '<i class="fas fa-folder-open"></i>');
          });

          categoryEl.appendChild(header);

          const filesContainer = document.createElement("div");
          filesContainer.className = "gallery-files";

          if (category.files.length === 0) {
            filesContainer.innerHTML = '<div class="gallery-empty-category">No files in this category.</div>';
          } else {
            category.files.forEach(file => {
              const fileEl = document.createElement("div");
              fileEl.className = "gallery-file";

              if (file.is_image) {
                const preview = document.createElement("img");
                preview.className = "gallery-preview";
                preview.alt = file.name;
                window.__TAURI__.core.invoke("get_gallery_file_preview", { path: file.path })
                  .then(dataUrl => { preview.src = dataUrl; })
                  .catch(() => { preview.style.display = "none"; });
                fileEl.appendChild(preview);
              } else {
                const iconBox = document.createElement("div");
                iconBox.className = "gallery-preview";
                iconBox.style.display = "flex";
                iconBox.style.alignItems = "center";
                iconBox.style.justifyContent = "center";
                iconBox.innerHTML = '<i class="fas fa-file" style="font-size: 1.5rem; opacity: 0.5;"></i>';
                fileEl.appendChild(iconBox);
              }

              const info = document.createElement("div");
              info.className = "gallery-file-info";

              const nameInput = document.createElement("input");
              nameInput.className = "gallery-file-name-input";
              nameInput.value = file.name;
              nameInput.title = "Click to rename";

              nameInput.addEventListener("change", async () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === file.name) {
                  nameInput.value = file.name;
                  return;
                }

                try {
                  const newPath = await window.__TAURI__.core.invoke("rename_gallery_file", {
                    oldPath: file.path,
                    newName: newName
                  });
                  file.name = newName;
                  file.path = newPath;
                  showConfirmation(copyBtn, '<i class="fas fa-copy"></i>');
                  nameInput.style.borderColor = "#4ade80";
                  setTimeout(() => { nameInput.style.borderColor = "transparent"; }, 1500);
                } catch (err) {
                  console.error("Failed to rename file:", err);
                  nameInput.value = file.name;
                }
              });

              info.appendChild(nameInput);
              fileEl.appendChild(info);

              const actions = document.createElement("div");
              actions.className = "gallery-file-actions";

              const ext = file.name.split(".").pop().toLowerCase();
              const isTextFile = ["txt", "json", "css", "js", "html", "md", "xml", "yml", "yaml", "ini", "cfg", "log"].includes(ext);

              const copyBtn = document.createElement("button");
              copyBtn.className = "juice-button";
              copyBtn.title = file.is_image ? "Copy Image (Base64)" : (isTextFile ? "Copy Content" : "Copy Path");
              copyBtn.innerHTML = '<i class="fas fa-copy"></i>';
              copyBtn.addEventListener("click", async () => {
                try {
                  if (file.is_image) {
                    const dataUrl = await window.__TAURI__.core.invoke("get_gallery_file_preview", { path: file.path });
                    await navigator.clipboard.writeText(dataUrl);
                  } else if (isTextFile) {
                    const content = await window.__TAURI__.core.invoke("read_text_file", { path: file.path });
                    await navigator.clipboard.writeText(content);
                  } else {
                    await navigator.clipboard.writeText(file.path);
                  }
                  showConfirmation(copyBtn, '<i class="fas fa-copy"></i>');
                } catch (err) {
                  console.error("Failed to copy:", err);
                }
              });

              const folderBtn = document.createElement("button");
              folderBtn.className = "juice-button";
              folderBtn.title = "Open File";
              folderBtn.innerHTML = '<i class="fas fa-external-link-alt"></i>';
              folderBtn.addEventListener("click", async () => {
                try {
                  await window.__TAURI__.core.invoke("open_gallery_folder", { path: file.path });
                  showConfirmation(folderBtn, '<i class="fas fa-external-link-alt"></i>');
                } catch (err) {
                  console.error("Failed to open file:", err);
                }
              });

              const deleteBtn = document.createElement("button");
              deleteBtn.className = "juice-button delete";
              deleteBtn.title = "Delete";
              deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
              deleteBtn.addEventListener("click", async () => {
                if (confirm(`Delete "${file.name}"?`)) {
                  try {
                    await window.__TAURI__.core.invoke("delete_gallery_file", { path: file.path });
                    loadGallery();
                  } catch (err) {
                    console.error("Failed to delete file:", err);
                  }
                }
              });

              actions.appendChild(copyBtn);
              actions.appendChild(folderBtn);
              actions.appendChild(deleteBtn);
              fileEl.appendChild(actions);

              filesContainer.appendChild(fileEl);
            });
          }

          categoryEl.appendChild(filesContainer);
          galleryContent.appendChild(categoryEl);
        });

      } catch (err) {
        console.error("Failed to load gallery:", err);
        galleryContent.innerHTML = '<div class="gallery-empty">Failed to load gallery.</div>';
      }
    };

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        await loadGallery(true);
        showConfirmation(refreshBtn, '<i class="fas fa-sync-alt"></i>');
      });
    }

    const galleryTab = document.querySelector('[data-tab="gallery"]');
    if (galleryTab) {
      galleryTab.addEventListener("click", () => {
        setTimeout(loadGallery, 100);
      });
    }

    const activeTab = localStorage.getItem("dawn-active-tab");
    if (activeTab === "gallery") {
      loadGallery();
    }
  };

  const initScripts = () => {
    let currentSkinFile = null;
    let currentSkinBuffer = null;
    let currentSkinName = "__texture__.0bed9187__.webp";

    let currentSoundFile = null;
    let currentSoundName = "__whoosh__.634f7dda.mp3";
    let soundPreviewAudio = null;

    const skinNameMap = {
      "revolver": "__texture__.0bed9187__.webp",
      "bayonet": "__texture__.76c24e59__.webp",
      "tomahawk": "__texture__.397a3f05__.webp",
      "ar9": "__texture__.1794de31__.webp",
      "vita": "__texture__.b2a49027__.webp",
      "scar": "__texture__.b3fc7981__.webp",
      "lar": "__texture__.d97db214__.webp",
      "mac10": "__texture__.36d894bd__.webp",
      "weatie": "__texture__.212a85fe__.webp",
      "shark": "__texture__.6c8a6582__.webp",
      "m60": "__texture__.b658c822__.webp"
    };

    const soundNameMap = {
      "dash": "__whoosh__.634f7dda.mp3",
      "hit": "__hit__.200043fa.mp3",
      "reload": "__reload__.fed3e0ac.mp3",
      "kill1": "__kill1__.623ec38b.mp3",
      "kill2": "__kill2__.8ffe9342.mp3",
      "kill3": "__kill3__.ba83d756.mp3",
      "kill4": "__kill4__.08568f50.mp3",
      "kill5": "__kill5__.cf529154.mp3",
      "wound1": "__wound1__.531f0649.mp3",
      "wound2": "__wound2__.6d084558.mp3",
      "userevolver": "__use__.cbf719c0.mp3",
      "usebayonet": "__use__.fd944232.mp3",
      "usevita": "__use__.5421e46b.mp3",
      "useweatie": "__use__.0621a61a.mp3",
      "usescar": "__use__.5ab6f364.mp3",
      "uselar": "__use__.8dd49954.mp3",
      "usear9": "__use__.6f884eb5.mp3",
      "usem60": "__use__.a6197a4d.mp3",
      "useshark": "__use__.4337da3c.mp3",
      "usemac10": "__use__.259ad4a5.mp3",
      "stepgrass": "__Grass__.9d721edd.mp3",
      "stepdirt": "__Earth__.37abd171.mp3",
      "stepmud": "__Mud__.44d00950.mp3",
      "stepsand": "__Sand__.10a59d13.mp3",
      "stepstone": "__Stone__.a9cedce8.mp3"
    };

    const skinSelect = document.getElementById("skin-select");
    const skinFileInput = document.getElementById("skin-file-input");
    const skinUploadArea = document.getElementById("skin-upload-area");
    const skinUrlInput = document.getElementById("skin-url-input");
    const skinPreviewContainer = document.getElementById("skin-preview-container");
    const skinPreview = document.getElementById("skin-preview");
    const saveSkinBtn = document.getElementById("save-skin-btn");
    const openSkinsFolderBtn = document.getElementById("open-skins-folder-btn");

    const soundSelect = document.getElementById("sound-select");
    const soundFileInput = document.getElementById("sound-file-input");
    const soundUploadArea = document.getElementById("sound-upload-area");
    const soundPreviewContainer = document.getElementById("sound-preview-container");
    const soundFilename = document.getElementById("sound-filename");
    const soundPlayBtn = document.getElementById("sound-play-btn");
    const soundVolume = document.getElementById("sound-volume");
    const soundVolumeIcon = document.getElementById("sound-volume-icon");
    const saveSoundBtn = document.getElementById("save-sound-btn");
    const openSoundsFolderBtn = document.getElementById("open-sounds-folder-btn");

    if (skinSelect) {
      skinSelect.addEventListener("change", (e) => {
        currentSkinName = skinNameMap[e.target.value] || skinNameMap["revolver"];
      });
    }

    if (soundSelect) {
      soundSelect.addEventListener("change", (e) => {
        currentSoundName = soundNameMap[e.target.value] || soundNameMap["dash"];
      });
    }

    if (skinUploadArea && skinFileInput) {
      skinUploadArea.addEventListener("click", () => skinFileInput.click());

      skinUploadArea.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        skinUploadArea.classList.add("drag-over");
      });

      skinUploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        skinUploadArea.classList.add("drag-over");
      });

      skinUploadArea.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        skinUploadArea.classList.remove("drag-over");
      });

      skinUploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        skinUploadArea.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (file) {
          if (file.type.startsWith("image/")) {
            handleSkinFile(file);
          } else {
            console.warn("File is not an image");
          }
        }
      });

      skinFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) handleSkinFile(file);
      });
    }

    const handleSkinFile = (file) => {
      currentSkinFile = file;
      currentSkinBuffer = null;
      const reader = new FileReader();
      reader.onload = (e) => {
        skinPreview.src = e.target.result;
        skinPreviewContainer.style.display = "block";
      };
      reader.readAsDataURL(file);
    };
    window.__handleSkinFile = handleSkinFile;

    if (skinUrlInput) {
      skinUrlInput.addEventListener("change", async (e) => {
        const url = e.target.value.trim();
        if (!url) return;
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Failed to fetch");
          const blob = await response.blob();
          if (!blob.type.startsWith("image/")) {
            alert("URL does not point to an image");
            return;
          }
          currentSkinFile = null;
          currentSkinBuffer = await blob.arrayBuffer();
          const objectURL = URL.createObjectURL(blob);
          skinPreview.src = objectURL;
          skinPreviewContainer.style.display = "block";
        } catch (err) {
          alert("Could not load image from URL");
        }
      });
    }

    if (saveSkinBtn) {
      saveSkinBtn.addEventListener("click", async () => {
        try {
          if (currentSkinFile) {
            const reader = new FileReader();
            reader.onload = async (e) => {
              const arrayBuffer = e.target.result;
              const uint8Array = new Uint8Array(arrayBuffer);
              await window.__TAURI__.core.invoke("save_skin", {
                skinName: currentSkinName,
                data: Array.from(uint8Array)
              });
              alert("Skin saved successfully!");
            };
            reader.readAsArrayBuffer(currentSkinFile);
          } else if (currentSkinBuffer) {
            const uint8Array = new Uint8Array(currentSkinBuffer);
            await window.__TAURI__.core.invoke("save_skin", {
              skinName: currentSkinName,
              data: Array.from(uint8Array)
            });
            alert("Skin saved successfully!");
          } else {
            alert("Please upload or provide a skin image first");
          }
        } catch (err) {
          alert("Failed to save skin: " + err);
        }
      });
    }

    if (openSkinsFolderBtn) {
      openSkinsFolderBtn.addEventListener("click", async () => {
        try {
          await window.__TAURI__.core.invoke("open_swapper_folder", { folderType: "skins" });
        } catch (err) {
          console.error("Failed to open skins folder:", err);
        }
      });
    }

    if (soundUploadArea && soundFileInput) {
      soundUploadArea.addEventListener("click", () => soundFileInput.click());

      soundUploadArea.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        soundUploadArea.classList.add("drag-over");
      });

      soundUploadArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        soundUploadArea.classList.add("drag-over");
      });

      soundUploadArea.addEventListener("dragleave", (e) => {
        e.preventDefault();
        e.stopPropagation();
        soundUploadArea.classList.remove("drag-over");
      });

      soundUploadArea.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        soundUploadArea.classList.remove("drag-over");
        const file = e.dataTransfer.files[0];
        if (file) {
          if (file.name.endsWith(".mp3")) {
            handleSoundFile(file);
          } else {
            console.warn("File is not an mp3");
          }
        }
      });

      soundFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) handleSoundFile(file);
      });
    }

    const handleSoundFile = (file) => {
      currentSoundFile = file;
      soundFilename.textContent = file.name;
      soundPreviewContainer.style.display = "block";

      if (soundPreviewAudio) {
        soundPreviewAudio.pause();
        soundPreviewAudio = null;
      }

      const objectURL = URL.createObjectURL(file);
      soundPreviewAudio = new Audio(objectURL);
      soundPreviewAudio.volume = soundVolume.value;

      const updatePlayIcon = () => {
        const icon = soundPlayBtn.querySelector("i");
        if (soundPreviewAudio.paused) {
          soundPlayBtn.classList.remove("playing");
          if (icon) icon.className = "fas fa-play";
        } else {
          soundPlayBtn.classList.add("playing");
          if (icon) icon.className = "fas fa-pause";
        }
      };

      soundPreviewAudio.onplay = updatePlayIcon;
      soundPreviewAudio.onpause = updatePlayIcon;
      soundPreviewAudio.onended = () => {
        updatePlayIcon();
        soundPreviewAudio.currentTime = 0;
      };
    };
    window.__handleSoundFile = handleSoundFile;

    if (soundPlayBtn) {
      soundPlayBtn.addEventListener("click", () => {
        if (!soundPreviewAudio) {
          console.warn("No audio loaded to play");
          return;
        }
        if (soundPreviewAudio.paused) {
          soundPreviewAudio.play();
        } else {
          soundPreviewAudio.pause();
        }
      });
    }

    if (soundVolume) {
      soundVolume.addEventListener("input", () => {
        if (soundPreviewAudio) {
          soundPreviewAudio.volume = soundVolume.value;
        }
        if (soundVolume.value == 0) {
          soundVolumeIcon.className = "fas fa-volume-mute";
        } else if (soundVolume.value < 0.5) {
          soundVolumeIcon.className = "fas fa-volume-down";
        } else {
          soundVolumeIcon.className = "fas fa-volume-up";
        }
      });
    }

    if (soundVolumeIcon) {
      soundVolumeIcon.addEventListener("click", () => {
        if (soundVolume.value > 0) {
          soundVolume.value = 0;
          soundVolumeIcon.className = "fas fa-volume-mute";
        } else {
          soundVolume.value = 1;
          soundVolumeIcon.className = "fas fa-volume-up";
        }
        if (soundPreviewAudio) {
          soundPreviewAudio.volume = soundVolume.value;
        }
      });
    }

    if (saveSoundBtn) {
      saveSoundBtn.addEventListener("click", async () => {
        if (!currentSoundFile) {
          alert("Please upload a sound file first");
          return;
        }
        try {
          const reader = new FileReader();
          reader.onload = async (e) => {
            const arrayBuffer = e.target.result;
            const uint8Array = new Uint8Array(arrayBuffer);
            await window.__TAURI__.core.invoke("save_sound", {
              soundName: currentSoundName,
              data: Array.from(uint8Array)
            });
            alert("Sound saved successfully!");
          };
          reader.readAsArrayBuffer(currentSoundFile);
        } catch (err) {
          alert("Failed to save sound: " + err);
        }
      });
    }

    if (openSoundsFolderBtn) {
      openSoundsFolderBtn.addEventListener("click", async () => {
        try {
          await window.__TAURI__.core.invoke("open_swapper_folder", { folderType: "sounds" });
        } catch (err) {
          console.error("Failed to open sounds folder:", err);
        }
      });
    }

    const initLocalCustoms = () => {
      const dropdowns = document.querySelectorAll(".script-dropdown-header");
      dropdowns.forEach(header => {
        header.addEventListener("click", () => {
          const dropdown = header.parentElement;
          const content = dropdown.querySelector(".script-dropdown-content");
          const isActive = dropdown.classList.toggle("active");
          content.style.display = isActive ? "flex" : "none";
        });
      });

      const addColorBtn = document.getElementById("add-gradient-color-btn");
      const colorsList = document.getElementById("local-gradient-colors");
      const rotSlider = document.getElementById("local_gradient_rot");
      const rotVal = document.getElementById("local_gradient_rot_val");
      const blurSlider = document.getElementById("local_gradient_blur");
      const blurVal = document.getElementById("local_gradient_blur_val");
      const shadowHex = document.getElementById("local_gradient_shadow_hex");
      const shadowColor = document.getElementById("local_gradient_shadow_color");
      const animatedCheckbox = document.getElementById("local_gradient_animated");
      const previewText = document.getElementById("local-gradient-preview-text");

      const updateLocalGradientPreview = () => {
        if (!previewText) return;
        const colors = Array.from(colorsList.querySelectorAll('input[type="color"]')).map(el => el.value);
        if (colors.length === 0) {
          previewText.style.background = "none";
          previewText.style.color = "#fff";
          return;
        }

        const rot = rotSlider.value + "deg";
        const shadow = (blurSlider.value === "0") ? "none" : `0 0 ${blurSlider.value}px ${shadowColor.value}`;
        const animated = animatedCheckbox.checked;

        previewText.style.display = "inline-block";
        previewText.style.background = `linear-gradient(${rot}, ${colors.join(", ")})`;
        previewText.style.backgroundClip = "text";
        previewText.style.webkitBackgroundClip = "text";
        previewText.style.color = "transparent";
        previewText.style.fontWeight = "800";
        previewText.style.textShadow = shadow;

        if (animated) {
          previewText.style.backgroundSize = "200% 200%";
          previewText.style.animation = "animated-gradient 3s linear infinite";
        } else {
          previewText.style.backgroundSize = "unset";
          previewText.style.animation = "none";
        }
      };

      if (rotSlider && rotVal) {
        rotSlider.addEventListener("change", (e) => {
          rotVal.textContent = e.target.value + "°";
          updateLocalGradientPreview();
          saveLocalCustoms();
          e.target.blur();
        });
        rotSlider.addEventListener("input", (e) => {
          rotVal.textContent = e.target.value + "°";
          updateLocalGradientPreview();
        });
      }

      if (blurSlider && blurVal) {
        blurSlider.addEventListener("change", (e) => {
          blurVal.textContent = e.target.value + "px";
          updateLocalGradientPreview();
          saveLocalCustoms();
          e.target.blur();
        });
        blurSlider.addEventListener("input", (e) => {
          blurVal.textContent = e.target.value + "px";
          updateLocalGradientPreview();
        });
      }

      if (shadowColor && shadowHex) {
        shadowColor.addEventListener("input", (e) => {
          shadowHex.value = e.target.value;
          updateLocalGradientPreview();
          saveLocalCustoms();
        });
        shadowHex.addEventListener("change", (e) => {
          let val = e.target.value;
          if (val === "0") {
            updateLocalGradientPreview();
            saveLocalCustoms();
            return;
          }
          if (!val.startsWith("#")) val = "#" + val;
          if (/^#[0-9A-F]{6}$/i.test(val)) {
            shadowColor.value = val;
            updateLocalGradientPreview();
            saveLocalCustoms();
          }
        });
      }

      if (animatedCheckbox) {
        animatedCheckbox.addEventListener("change", (e) => {
          updateLocalGradientPreview();
          saveLocalCustoms();
          e.target.blur();
        });
      }

      const createColorItem = (value = "#ffffff") => {
        const item = document.createElement("div");
        item.className = "color-item";
        item.innerHTML = `
          <div class="reorder-btns">
            <button class="reorder-btn up"><i class="fas fa-chevron-up"></i></button>
            <button class="reorder-btn down"><i class="fas fa-chevron-down"></i></button>
          </div>
          <input type="color" value="${value}">
          <input type="text" value="${value}" maxlength="7">
          <button class="remove-btn"><i class="fas fa-trash"></i></button>
        `;

        const colorPicker = item.querySelector('input[type="color"]');
        const colorHex = item.querySelector('input[type="text"]');
        const removeBtn = item.querySelector(".remove-btn");
        const upBtn = item.querySelector(".up");
        const downBtn = item.querySelector(".down");

        colorPicker.addEventListener("input", (e) => {
          colorHex.value = e.target.value;
          updateLocalGradientPreview();
          saveLocalCustoms();
        });

        colorHex.addEventListener("change", (e) => {
          let val = e.target.value;
          if (!val.startsWith("#")) val = "#" + val;
          if (/^#[0-9A-F]{6}$/i.test(val)) {
            colorPicker.value = val;
            updateLocalGradientPreview();
            saveLocalCustoms();
          }
        });

        removeBtn.addEventListener("click", () => {
          item.remove();
          updateLocalGradientPreview();
          saveLocalCustoms();
        });

        upBtn.addEventListener("click", () => {
          if (item.previousElementSibling) {
            colorsList.insertBefore(item, item.previousElementSibling);
            updateLocalGradientPreview();
            saveLocalCustoms();
          }
        });

        downBtn.addEventListener("click", () => {
          if (item.nextElementSibling) {
            colorsList.insertBefore(item.nextElementSibling, item);
            updateLocalGradientPreview();
            saveLocalCustoms();
          }
        });

        return item;
      };

      if (addColorBtn) {
        addColorBtn.addEventListener("click", () => {
          colorsList.appendChild(createColorItem());
          updateLocalGradientPreview();
          saveLocalCustoms();
        });
      }

      const addBadgeBtn = document.getElementById("add-local-badge-btn");
      const badgesList = document.getElementById("local-badges-list");

      const createBadgeItem = (url = "") => {
        const item = document.createElement("div");
        item.className = "badge-item";
        item.innerHTML = `
          <div class="reorder-btns">
            <button class="reorder-btn up"><i class="fas fa-chevron-up"></i></button>
            <button class="reorder-btn down"><i class="fas fa-chevron-down"></i></button>
          </div>
          <img src="${url || 'https://kirka.io/favicon.ico'}" class="badge-preview">
          <input type="text" value="${url}" placeholder="Badge URL">
          <button class="remove-btn"><i class="fas fa-trash"></i></button>
        `;

        const input = item.querySelector('input[type="text"]');
        const preview = item.querySelector(".badge-preview");
        const removeBtn = item.querySelector(".remove-btn");
        const upBtn = item.querySelector(".up");
        const downBtn = item.querySelector(".down");

        input.addEventListener("change", (e) => {
          preview.src = e.target.value || "https://kirka.io/favicon.ico";
          saveLocalCustoms();
        });

        removeBtn.addEventListener("click", () => {
          item.remove();
          saveLocalCustoms();
        });

        upBtn.addEventListener("click", () => {
          if (item.previousElementSibling) {
            badgesList.insertBefore(item, item.previousElementSibling);
            saveLocalCustoms();
          }
        });

        downBtn.addEventListener("click", () => {
          if (item.nextElementSibling) {
            badgesList.insertBefore(item.nextElementSibling, item);
            saveLocalCustoms();
          }
        });

        return item;
      };

      if (addBadgeBtn) {
        addBadgeBtn.addEventListener("click", () => {
          badgesList.appendChild(createBadgeItem());
          saveLocalCustoms();
        });
      }

      const saveLocalCustoms = () => {
        const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");

        const colors = Array.from(colorsList.querySelectorAll('input[type="color"]')).map(el => el.value);
        const badges = Array.from(badgesList.querySelectorAll('input[type="text"]')).map(el => el.value).filter(v => v);

        settings.local_gradient_colors = colors;
        settings.local_badges = badges;
        settings.local_gradient_rot = rotSlider.value;
        settings.local_gradient_blur = blurSlider.value;
        settings.local_gradient_shadow_color = (blurSlider.value === "0") ? "0" : shadowColor.value;
        settings.local_gradient_animated = animatedCheckbox.checked;

        localStorage.setItem("dawn-settings", JSON.stringify(settings));
        document.dispatchEvent(new CustomEvent("dawn-settings-changed", { detail: { settings } }));
      };

      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      if (settings.local_gradient_colors) {
        settings.local_gradient_colors.forEach(c => colorsList.appendChild(createColorItem(c)));
      }
      if (settings.local_badges) {
        settings.local_badges.forEach(b => badgesList.appendChild(createBadgeItem(b)));
      }
      if (settings.local_gradient_rot) {
        rotSlider.value = settings.local_gradient_rot;
        rotVal.textContent = settings.local_gradient_rot + "°";
      }
      if (settings.local_gradient_blur) {
        blurSlider.value = settings.local_gradient_blur;
        blurVal.textContent = settings.local_gradient_blur + "px";
      }
      if (settings.local_gradient_shadow_color) {
        shadowColor.value = settings.local_gradient_shadow_color;
        shadowHex.value = settings.local_gradient_shadow_color;
      }
      if (settings.local_gradient_animated) {
        animatedCheckbox.checked = true;
      }
      updateLocalGradientPreview();
    };

    initLocalCustoms();
  };

  function startInit() {
    if (!document.body || !document.head) {
      setTimeout(startInit, 100);
      return;
    }
    init();
    initDiscordRPC();
    initGallery();
    initScripts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startInit);
  } else {
    startInit();
  }

  const base_url = "https://kirka.io/";
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    trace: console.trace
  };

  let profileOpened = false;

  const customNotification = (data) => {
    const notifElement = document.createElement("div");
    notifElement.classList.add("vue-notification-wrapper");
    notifElement.style =
      "transition-timing-function: ease; transition-delay: 0s; transition-property: all;";
    notifElement.innerHTML = `
    <div
      style="
        display: flex;
        align-items: center;
        padding: .9rem 1.1rem;
        margin-bottom: .5rem;
        color: var(--white);
        cursor: pointer;
        box-shadow: 0 0 0.7rem rgba(0,0,0,.25);
        border-radius: .2rem;
        background: linear-gradient(262.54deg,#202639 9.46%,#223163 100.16%);
        margin-left: 1rem;
        border: solid .15rem #ffb914;
        font-family: Exo\ 2;" class="alert-default"
    > ${data.icon
        ? `
        <img
          src="${data.icon}"
          style="
            min-width: 2rem;
            height: 2rem;
            margin-right: .9rem;"
        />`
        : ""
      }
      <span style="font-size: 1rem; font-weight: 600; text-align: left;" class="text">${data.message
      }</span>
    </div>`;

    document
      .getElementsByClassName("vue-notification-group")[0]
      .children[0].appendChild(notifElement);

    setTimeout(() => {
      try {
        notifElement.remove();
      } catch { }
    }, 5000);
  };

  let friendsInterval = null;
  const handleFriends = () => {
    if (friendsInterval) clearInterval(friendsInterval);

    const handleFriendStatusClick = (e) => {
      if (e.shiftKey && e.target.classList.contains("online")) {
        const online = e.target;
        if (online && online.innerText.includes("in game")) {
          const match = online.innerText.match(/\[(.*?)\]/);
          if (match) {
            const content = match[1];
            const gameLink = `${base_url}games/${content}`;
            navigator.clipboard.writeText(gameLink);
            customNotification({
              message: `Copied game link: ${gameLink}`,
            });
          }
        }
      }
    };
    document.addEventListener("click", handleFriendStatusClick);

    friendsInterval = setInterval(() => {
      if (!window.location.href.includes("friends")) {
        clearInterval(friendsInterval);
        document.removeEventListener("click", handleFriendStatusClick);
        return;
      }

      const friendsCont = document.querySelector(".friends > .content > .allo");
      const limit = document.querySelector(".friends > .content > .tabs > .limit");
      const addFriends = document.querySelector(".friends > .add-friends");
      if (!friendsCont || !limit || !addFriends) return;

      const friendsList = friendsCont.querySelector(".list");
      const requestsList = friendsCont.querySelector(".requests");

      if (!addFriends.querySelector(".search-friends")) {
        const searchFriends = document.createElement("div");
        searchFriends.className = "search-friends";
        searchFriends.style = `display: flex; flex-direction: column; align-items: flex-start; margin-top: 1.5rem; padding: 0 1rem;`;
        searchFriends.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: .5rem; width: 100%;">
            <span class="search-text">Search</span>
            <span style="opacity:0.5; font-size: 10px;">Filter list</span>
          </div>
          <input type="text" placeholder="ENTER USERNAME OR ID" class="search-input" style="border: .125rem solid #202639; outline: none; background: #2f3957; width: 100%; height: 2.875rem; padding-left: .5rem; box-sizing: border-box; font-weight: 600; font-size: 1rem; color: #f2f2f2; box-shadow: 0 1px 2px rgba(0,0,0,.4), inset 0 0 8px rgba(0,0,0,.4); border-radius: .25rem;"/>`;
        addFriends.appendChild(searchFriends);

        searchFriends.querySelector(".search-input").addEventListener("input", (e) => {
          const query = e.target.value.toLowerCase();
          document.querySelectorAll(".friend").forEach((friend) => {
            const nickname = friend.querySelector(".nickname")?.innerText.toLowerCase() || "";
            const shortId = friend.querySelector(".friend-id")?.innerText.toLowerCase() || "";
            friend.style.display = (nickname.includes(query) || shortId.includes(query)) ? "flex" : "none";
          });
        });
      }

      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      const customizations = JSON.parse(localStorage.getItem("juice-customizations") || "[]");

      document.querySelectorAll(".friend").forEach(friend => {
        const online = friend.querySelector(".online");
        if (online && online.textContent.trim().toLowerCase().includes("in game")) {
          if (!friend.querySelector(".spectate-eye")) {
            const match = online.textContent.match(/\[(.*?)\]/);
            const code = match ? match[1] : null;
            if (code) {
              const eyeDiv = document.createElement("div");
              eyeDiv.className = "spectate-eye";
              eyeDiv.innerHTML = '<i class="fa-solid fa-eye"></i>';
              eyeDiv.style = "cursor: pointer; margin-left: 5px; opacity: 0.6; transition: 0.2s;";
              eyeDiv.onmouseover = () => eyeDiv.style.opacity = "1";
              eyeDiv.onmouseout = () => eyeDiv.style.opacity = "0.6";

              online.insertAdjacentElement("afterend", eyeDiv);
              eyeDiv.addEventListener("click", e => {
                e.stopPropagation();
                document.querySelector(".home")?.click();
                setTimeout(() => {
                  document.querySelector(".join-btn")?.click();
                  const joinObserver = new MutationObserver((mut, obs) => {
                    const input = document.querySelector(".input");
                    if (input) {
                      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                      nativeSetter.call(input, code);
                      input.dispatchEvent(new Event("input", { bubbles: true }));
                      document.querySelector(".btn:nth-child(2)")?.click();
                      obs.disconnect();
                    }
                  });
                  joinObserver.observe(document.body, { childList: true, subtree: true });
                }, 200);
              });
            }
          }
        }

        if (settings.customizations !== false) {
          const shortId = friend.querySelector(".friend-id")?.innerText;
          if (!shortId) return;
          const customs = customizations.find(c => c.shortId === shortId);
          if (customs) {
            const nickname = friend.querySelector(".nickname");
            if (nickname && customs.gradient) {
              nickname.style.display = "flex";
              nickname.style.alignItems = "flex-end";
              nickname.style.gap = "0.25rem";
              nickname.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
              nickname.style.backgroundClip = "text";
              nickname.style.webkitBackgroundClip = "text";
              nickname.style.color = "transparent";
              nickname.style.fontWeight = "700";
              nickname.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";
              nickname.style.overflow = "unset";

              if (settings.animations !== false && customs.animated) {
                nickname.style.backgroundSize = "200% 200%";
                nickname.style.animation = "animated-gradient 3s linear infinite";
              }
            }

            if (nickname && !nickname.querySelector(".juice-badges")) {
              const badgesElem = document.createElement("div");
              badgesElem.style = "display: flex; gap: 0.25rem; align-items: center; width: 0;";
              badgesElem.className = "juice-badges";
              nickname.appendChild(badgesElem);

              const badgeStyle = "height: 18px; width: auto;";
              if (customs.badges) {
                customs.badges.forEach(badge => {
                  const img = document.createElement("img");
                  if (badge.startsWith("/") || badge.match(/^[A-Za-z]:\\/)) {
                    const cleanPath = badge.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "").replace(/^\//, "");
                    img.src = `dawn://localhost/${cleanPath}`;
                  } else {
                    img.src = badge;
                  }
                  img.style = badgeStyle;
                  badgesElem.appendChild(img);
                });
              }
            }
          }
        }
      });

      if (friendsList) {
        limit.innerText = `${friendsList.children.length}/250`;
      } else if (requestsList) {
        limit.innerText = `${requestsList.children.length} Requests`;
      }
    }, 250);
  };


  let lobbyInterval = null;
  const handleLobby = () => {
    if (lobbyInterval) clearInterval(lobbyInterval);

    let settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
    const customizations = JSON.parse(localStorage.getItem("juice-customizations") || "[]");
    const clancustomizations = JSON.parse(localStorage.getItem("juice-clans") || "[]");

    if (window._dawnLobbyListener) {
      document.removeEventListener("dawn-settings-changed", window._dawnLobbyListener);
    }
    window._dawnLobbyListener = () => {
      settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      applyCustoms();
      applyClanCustoms();
    };
    document.addEventListener("dawn-settings-changed", window._dawnLobbyListener);


    const addDiscordButton = () => {
      const btn = document.querySelectorAll(".card-cont.soc-group")[1];
      if (!btn || document.querySelector("#dawn-discord-btn")) return;

      const discordBtn = btn.cloneNode(true);
      discordBtn.className = "card-cont soc-group transition-none";
      discordBtn.id = "dawn-discord-btn";
      discordBtn.style = `
        background: radial-gradient(circle at 75%, #FFCA8A 0%, rgba(255, 123, 0, 1) 33%) !important;
        border-bottom-color: rgba(255, 100, 0, 1) !important;
        border-top-color: rgba(252, 167, 69, 1) !important;
        border-right-color: rgba(115, 63, 0, 1) !important;
        border-radius: 0 0 2px 5px !important;`;

      const textDivs = discordBtn.querySelector(".text-soc").children;
      textDivs[0].innerText = "DAWN";
      textDivs[1].innerText = "DISCORD";

      const i = document.createElement("i");
      i.className = "fab fa-discord";
      i.style.fontSize = "48px";
      i.style.fontFamily = "Font Awesome 6 Brands";
      i.style.margin = "3.2px 1.6px 0 1.6px";
      i.style.textShadow = "0 0 0 transparent";
      discordBtn.querySelector("svg").replaceWith(i);

      discordBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = "https://discord.gg/VsMEQ3HWs2";
        a.target = "_blank";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 100);
      };

      btn.replaceWith(discordBtn);
    };

    const initRoomPresets = () => {
      let presets = JSON.parse(localStorage.getItem("dawn-room-presets") || "[]");

      const savePresets = () => {
        localStorage.setItem("dawn-room-presets", JSON.stringify(presets));
      };

      const scrapeSettings = (modal) => {
        const settings = { selects: {}, checkboxes: {}, inputs: {} };

        modal.querySelectorAll(".element").forEach(el => {
          const labelEl = el.querySelector(".label");
          if (!labelEl) return;
          const label = labelEl.textContent.trim().split(" ")[0].split("\n")[0];
          const selected = el.querySelector(".right .selected")?.textContent.trim();
          if (label && selected) settings.selects[label] = selected;
        });

        modal.querySelectorAll(".custom-checkbox").forEach(cb => {
          const label = cb.querySelector("span")?.textContent.trim();
          const input = cb.querySelector("input");
          if (label && input) settings.checkboxes[label] = input.checked;
        });

        const mapInput = modal.querySelector(".keybind-input input");
        if (mapInput) settings.inputs.mapCode = mapInput.value;

        const nameInput = modal.querySelector(".server-name-input input");
        if (nameInput) settings.inputs.serverName = nameInput.value;

        return settings;
      };

      const applyPreset = async (modal, preset) => {
        const elements = Array.from(modal.querySelectorAll(".element"));

        for (const el of elements) {
          const labelEl = el.querySelector(".label");
          if (!labelEl) continue;
          const label = labelEl.textContent.trim().split(" ")[0].split("\n")[0];
          const targetVal = preset.settings.selects[label];

          if (targetVal) {
            const rightPart = el.querySelector(".right");
            const selectedEl = rightPart?.querySelector(".selected");

            if (selectedEl && selectedEl.textContent.trim() !== targetVal) {
              rightPart.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
              rightPart.click();

              await new Promise(resolve => setTimeout(resolve, 150));

              let options = Array.from(el.querySelectorAll(".items div"));
              if (options.length === 0) {
                options = Array.from(document.querySelectorAll(".items div"));
              }

              for (const opt of options) {
                if (opt.textContent.trim() === targetVal) {
                  opt.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
                  opt.click();
                  opt.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
                  break;
                }
              }

              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }

        modal.querySelectorAll(".custom-checkbox").forEach(cb => {
          const label = cb.querySelector("span")?.textContent.trim();
          const targetState = preset.settings.checkboxes[label];
          const input = cb.querySelector("input");
          if (label && targetState !== undefined && input.checked !== targetState) {
            input.click();
          }
        });

        const mapInput = modal.querySelector(".keybind-input input");
        if (mapInput) {
          mapInput.value = preset.settings.inputs.mapCode || "";
          mapInput.dispatchEvent(new Event("input", { bubbles: true }));
        }

        const nameInput = modal.querySelector(".server-name-input input");
        if (nameInput) {
          nameInput.value = preset.settings.inputs.serverName || "";
          nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };

      const renderPresets = (container, modal) => {
        const list = container.querySelector(".room-presets-list");
        list.innerHTML = "";

        if (presets.length === 0) {
          list.innerHTML = `<div style="text-align: center; opacity: 0.5; padding: 20px; font-size: 0.9rem;">No presets saved</div>`;
        }

        presets.forEach((preset, index) => {
          const item = document.createElement("div");
          item.className = "room-preset-item";
          item.innerHTML = `
          <div class="room-preset-name">${preset.name}</div>
          <div class="room-preset-actions">
            <i class="fas fa-edit room-preset-action rename" title="Rename"></i>
            <i class="fas fa-trash room-preset-action delete" title="Delete"></i>
          </div>
        `;

          item.onclick = async (e) => {
            if (e.target.closest(".room-preset-action")) return;

            if (item.dataset.loading === "true") return;
            item.dataset.loading = "true";

            const nameEl = item.querySelector(".room-preset-name");
            const originalName = preset.name;

            nameEl.innerHTML = `<i class="fas fa-spinner fa-spin" style="color: var(--green); margin-right: 5px;"></i> APPLYING...`;

            await applyPreset(modal, preset);

            nameEl.innerHTML = `<i class="fas fa-check" style="color: var(--green); margin-right: 5px;"></i> LOADED`;

            setTimeout(() => {
              nameEl.textContent = originalName;
              delete item.dataset.loading;
            }, 1000);
          };

          item.querySelector(".rename").onclick = (e) => {
            e.stopPropagation();
            const newName = prompt("Enter new name for preset:", preset.name);
            if (newName) {
              preset.name = newName;
              savePresets();
              renderPresets(container, modal);
            }
          };

          item.querySelector(".delete").onclick = (e) => {
            e.stopPropagation();
            if (confirm("Are you sure you want to delete this preset?")) {
              presets.splice(index, 1);
              savePresets();
              renderPresets(container, modal);
            }
          };

          list.appendChild(item);
        });
      };

      const injectSidebar = (container) => {
        if (container.querySelector(".room-presets-sidebar")) return;

        container.querySelector(".vm--modal").style.overflow = "visible";

        const sidebar = document.createElement("div");
        sidebar.className = "room-presets-sidebar";
        sidebar.innerHTML = `
        <div class="room-presets-header">
          <div class="room-presets-title">PRESETS</div>
        </div>
        <div class="room-presets-list"></div>
        <div class="juice-button save-preset">
          <i class="fas fa-plus"></i> SAVE CURRENT
        </div>
        `;

        sidebar.querySelector(".save-preset").onclick = () => {
          const name = prompt("Enter name for this preset:", `Preset ${presets.length + 1}`);
          if (name) {
            const modalInner = container.querySelector(".vm--modal");
            const settings = scrapeSettings(modalInner);
            presets.push({ name, settings });
            savePresets();
            renderPresets(sidebar, modalInner);

            const btn = sidebar.querySelector(".save-preset");
            const originalHTML = btn.innerHTML;
            const originalBG = btn.style.background;
            const originalColor = btn.style.color;

            btn.innerHTML = `<i class="fas fa-check"></i> SAVED!`;
            btn.style.background = "var(--green)";
            btn.style.color = "#fff";

            setTimeout(() => {
              btn.innerHTML = originalHTML;
              btn.style.background = originalBG;
              btn.style.color = originalColor;
            }, 1500);
          }
        };

        const modal = container.querySelector(".vm--modal");
        if (modal) {
          modal.appendChild(sidebar);
          renderPresets(sidebar, modal);
        }
      };

      const createObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && node.classList.contains("vm--container")) {
              setTimeout(() => {
                if (node.querySelector(".create-btn")) {
                  injectSidebar(node);
                }
              }, 100);
            }
          }
        }
      });

      const interfaceEl = document.querySelector("#app .interface") || document.querySelector(".interface");
      if (interfaceEl) {
        createObserver.observe(interfaceEl, { childList: true });
      } else {
        observeForElement(".interface", (iface) => {
          createObserver.observe(iface, { childList: true });
        }, document.querySelector("#app") || document.body);
      }
    };

    const applyCustoms = () => {
      const lobbyNickname = document.querySelector(".team-section .heads .nickname");
      if (!lobbyNickname) return;

      if (!settings.customizations) {
        lobbyNickname.style = "";
        lobbyNickname.querySelector(".juice-badges")?.remove();
        return;
      }

      const avatarUsername = document.querySelector(".avatar-info .username");
      if (!avatarUsername) return;

      const shortIdCard = avatarUsername.textContent.trim().split("#")[1];
      if (!shortIdCard) return;

      localStorage.setItem("user-id", shortIdCard);

      let customs = customizations.find((c) => c.shortId === shortIdCard);

      if (settings.local_customs_enabled && shortIdCard === localStorage.getItem("user-id")) {
        customs = {
          gradient: {
            rot: (settings.local_gradient_rot || 90) + "deg",
            stops: settings.local_gradient_colors || [],
            shadow: (settings.local_gradient_shadow_color === "0") ? "0 0 0 transparent" : `0 0 ${settings.local_gradient_blur || 5}px ${settings.local_gradient_shadow_color || "#000000"}`
          },
          animated: settings.local_gradient_animated,
          badges: settings.local_badges || []
        };
      }

      if (!customs) return;

      if (customs.gradient && customs.gradient.stops && customs.gradient.stops.length > 0) {
        lobbyNickname.style.display = "flex";
        lobbyNickname.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
        lobbyNickname.style.backgroundClip = "text";
        lobbyNickname.style.webkitBackgroundClip = "text";
        lobbyNickname.style.color = "transparent";
        lobbyNickname.style.fontWeight = "700";
        lobbyNickname.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";
        lobbyNickname.style.alignItems = "flex-end";
        lobbyNickname.style.gap = "0.25rem";
        lobbyNickname.style.overflow = "unset";

        if (customs.animated && (settings.animations !== false)) {
          lobbyNickname.style.backgroundSize = "200% 200%";
          lobbyNickname.style.animation = "animated-gradient 3s linear infinite";
        }
      }

      if (!lobbyNickname.querySelector(".juice-badges")) {
        const badgesElem = document.createElement("div");
        badgesElem.style = "display: flex; gap: 0.25rem; align-items: center; width: 0;";
        badgesElem.className = "juice-badges";
        lobbyNickname.appendChild(badgesElem);

        const badgeStyle = "height: 32px; width: auto;";

        if (customs.badges && customs.badges.length) {
          customs.badges.forEach((badge) => {
            const img = document.createElement("img");
            if (badge.startsWith("/") || badge.match(/^[A-Za-z]:\\/)) {
              const cleanPath = badge.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "").replace(/^\//, "");
              img.src = `dawn://localhost/${cleanPath}`;
            } else {
              img.src = badge;
            }
            img.style = badgeStyle;
            badgesElem.appendChild(img);
          });
        }
      }
    };

    const applyClanCustoms = () => {
      const clan = document.querySelector(".team-section .heads .clan-tag");
      if (!clan) return;

      if (!settings.customizations) {
        clan.style = "";
        return;
      }
      const userClan = clan.textContent.trim();
      const customs = clancustomizations.find((c) => c.clan === userClan);
      if (!customs) return;

      if (customs.gradient) {
        clan.style.display = "inline-block";
        clan.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
        clan.style.backgroundClip = "text";
        clan.style.webkitBackgroundClip = "text";
        clan.style.color = "transparent";
        clan.style.fontWeight = "700";
        clan.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";

        if (customs.animated && (settings.animations !== false)) {
          clan.style.backgroundSize = "200% 200%";
          clan.style.animation = "animated-gradient 3s linear infinite";
        }
      }
    };

    const formatMetrics = () => {
      const moneys = document.querySelectorAll(".moneys > .card-cont");
      moneys.forEach(m => {
        if (!m.dataset.formatted) {
          const val = parseInt(m.innerText.replace(/,/g, ""));
          if (!isNaN(val)) {
            m.innerHTML = m.innerHTML.replace(m.innerText, val.toLocaleString());
            m.dataset.formatted = true;
          }
        }
      });

      const exp = document.querySelector(".exp-values");
      if (exp && !exp.dataset.formatted) {
        const parts = exp.innerText.split("/");
        if (parts.length === 2) {
          exp.innerText = `${parseInt(parts[0]).toLocaleString()}/${parseInt(parts[1]).toLocaleString()}`;
          exp.dataset.formatted = true;
        }
      }
    };

    lobbyInterval = setInterval(() => {
      if (!window.location.href.includes(base_url) && !window.location.href.startsWith(base_url)) return;

      addDiscordButton();
      initRoomPresets();
      applyCustoms();
      applyClanCustoms();
      formatMetrics();
    }, 1000);

    observeForElement("#app #left-icons", injectLobbyReminder);
    setTimeout(injectLobbyReminder, 500);
    setTimeout(injectLobbyReminder, 2000);
  };

  let inGameInterval = null;
  const handleInGame = () => {
    if (inGameInterval) clearInterval(inGameInterval);

    const versionEl = document.querySelector("#version");
    if (versionEl) {
      const updateFpsVisibility = () => {
        isFpsOverlayActive = !!versionEl.innerHTML.includes("VERSION");
      };

      const fpsObserver = new MutationObserver(updateFpsVisibility);
      fpsObserver.observe(versionEl, { characterData: true, childList: true, subtree: true });

      updateFpsVisibility();

      const cleanupObserver = new MutationObserver(() => {
        if (fpsEl && fpsEl.isConnected) {
          const wrapper = fpsEl.parentElement;
          if (wrapper) wrapper.remove();
          fpsEl = null;
          isFpsOverlayActive = false;
        }
      });
      cleanupObserver.observe(versionEl, { characterData: true });
    }

    let red_players = [];
    let blue_players = [];

    let settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
    const customizations = JSON.parse(localStorage.getItem("juice-customizations") || "[]");
    const clancustomizations = JSON.parse(localStorage.getItem("juice-clans") || "[]");

    if (window._dawnInGameListener) {
      document.removeEventListener("dawn-settings-changed", window._dawnInGameListener);
    }
    window._dawnInGameListener = (e) => {
      settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");

      if (!settings.display_kd) {
        document.querySelector(".kill-death .kd")?.remove();
      } else {
        createKD();
      }

      if (settings.colored_killfeed) {
        colorKillFeed();
      }

      applyEscUI();
      applyInGameUI();
    };
    document.addEventListener("dawn-settings-changed", window._dawnInGameListener);


    const updatePlayerLists = () => {
      red_players = [];
      blue_players = [];

      const red_players_cont = document.querySelectorAll(".desktop-game-interface .player-left-cont .player-cont");
      const blue_players_cont = document.querySelectorAll(".desktop-game-interface .player-right-cont .player-cont");

      red_players_cont.forEach((player) => {
        const nickname = player.querySelector(".nickname")?.innerText;
        if (nickname) red_players.push(nickname.trim());
      });

      blue_players_cont.forEach((player) => {
        const nickname = player.querySelector(".nickname")?.innerText;
        if (nickname) blue_players.push(nickname.trim());
      });
    };

    const colorKillFeed = () => {
      if (!settings.colored_killfeed) return;
      const killBarItem = document.querySelectorAll(".desktop-game-interface .kill-bar-cont .kill-bar-item");
      killBarItem.forEach((item) => {
        const killer = item.firstChild;
        if (!killer || !killer.innerText) return;

        const killerName = killer.innerText.trim();
        if (red_players.includes(killerName)) {
          item.classList.add("red");
          item.classList.remove("blue");
        } else if (blue_players.includes(killerName)) {
          item.classList.add("blue");
          item.classList.remove("red");
        }
      });
    };

    const updateKD = () => {
      if (!settings.display_kd) return;
      const kills = document.querySelector(".kill-death .kill");
      const deaths = document.querySelector("div > svg.icon-death")?.parentElement;
      const kd = document.querySelector(".kill-death .kd");

      if (!kills || !deaths || !kd) return;

      const killCount = parseFloat(kills.innerText);
      const deathCount = parseFloat(deaths.innerText) || 1;
      let kdRatio = (killCount / (deathCount === 0 ? 1 : deathCount)).toFixed(2);

      kd.innerHTML = `<span class="kd-ratio">${kdRatio}</span> <span class="text-kd" style="font-size: 0.75rem; opacity: 0.6;">K/D</span>`;
    };

    const createKD = () => {
      if (!settings.display_kd) return;
      if (document.querySelector(".kill-death .kd")) return;

      const kills = document.querySelector(".kill-death .kill");
      const deaths = document.querySelector("div > svg.icon-death")?.parentElement;
      if (!kills || !deaths) return;

      const kd = kills.cloneNode(true);
      kd.classList.add("kd");
      kd.classList.remove("kill");
      kd.style.display = "flex";
      kd.style.alignItems = "center";
      kd.style.gap = "0.25rem";
      kd.innerHTML = `<span class="kd-ratio">0.00</span> <span class="text-kd" style="font-size: 0.75rem; opacity: 0.6;">K/D</span>`;

      document.querySelector(".kill-death").appendChild(kd);

      const kdObserver = new MutationObserver(() => updateKD());
      kdObserver.observe(kills, { characterData: true, childList: true, subtree: true });
      kdObserver.observe(deaths, { characterData: true, childList: true, subtree: true });

      updateKD();
    };

    const applyCustomsToPlayer = (player, isEsc = false) => {
      const nickname = isEsc ? player.querySelector(".player-name .nickname") : player.querySelector(".nickname");
      const playerLeft = player.querySelector(".player-left");

      if (!settings.customizations || !nickname) {
        player.querySelector(".juice-badges")?.remove();
        if (nickname) {
          nickname.style = "";
          const span = nickname.querySelector(".nickname-span");
          if (span) span.style = "";
          const sideId = nickname.querySelector(".short-id");
          if (sideId) sideId.style = "";
        }
        if (playerLeft) playerLeft.style = "";
        return;
      }

      let shortId = "";
      if (isEsc) {
        shortId = nickname.querySelector(".short-id")?.innerText.replace("#", "").trim();
      } else {
        shortId = player.querySelector(".short-id")?.innerText.replace("#", "").trim();
      }

      if (!shortId) {
        player.querySelector(".juice-badges")?.remove();
        nickname.style = "";
        if (playerLeft) playerLeft.style = "";
        return;
      }

      let customs = customizations.find((c) => c.shortId === shortId);

      if (settings.local_customs_enabled && shortId === localStorage.getItem("user-id")) {
        customs = {
          gradient: {
            rot: (settings.local_gradient_rot || 90) + "deg",
            stops: settings.local_gradient_colors || [],
            shadow: (settings.local_gradient_shadow_color === "0") ? "0 0 0 transparent" : `0 0 ${settings.local_gradient_blur || 5}px ${settings.local_gradient_shadow_color || "#000000"}`
          },
          animated: settings.local_gradient_animated,
          badges: settings.local_badges || []
        };
      }

      if (customs) {
        let badgesElem = player.querySelector(".juice-badges");

        if (!badgesElem || badgesElem.dataset.shortId !== shortId) {
          badgesElem?.remove();
          badgesElem = document.createElement("div");
          badgesElem.style = "display: flex; gap: 0.25rem; align-items: center; margin-left: 0.25rem;";
          badgesElem.className = "juice-badges";
          badgesElem.dataset.shortId = shortId;

          nickname.style.overflow = "unset";

          if (isEsc) {
            const shortIdElem = nickname.querySelector(".short-id");
            nickname.insertBefore(badgesElem, shortIdElem);
          } else {
            if (playerLeft) {
              playerLeft.style.width = "0";
              playerLeft.insertBefore(badgesElem, playerLeft.lastChild);
            }
          }
        } else {
          badgesElem.innerHTML = "";
        }

        const badgeStyle = "height: 22px; width: auto;";

        if (customs.gradient && customs.gradient.stops && customs.gradient.stops.length > 0) {
          nickname.style.display = isEsc ? "flex" : "inline-block";
          if (isEsc) nickname.style.flexDirection = "row";

          nickname.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
          nickname.style.backgroundClip = "text";
          nickname.style.webkitBackgroundClip = "text";
          nickname.style.color = "transparent";
          nickname.style.fontWeight = "700";
          nickname.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";

          if (isEsc) {
            const sideId = nickname.querySelector(".short-id");
            if (sideId) {
              sideId.style.background = "none";
              sideId.style.webkitBackgroundClip = "unset";
              sideId.style.backgroundClip = "unset";
              sideId.style.color = "";
              sideId.style.textShadow = "none";
            }
          }

          if (settings.animations && customs.animated) {
            nickname.style.backgroundSize = "200% 200%";
            nickname.style.animation = "animated-gradient 3s linear infinite";
          }
        }

        const addBadge = (src) => {
          const img = document.createElement("img");
          if (src.startsWith("/") || src.match(/^[A-Za-z]:\\/)) {
            const cleanPath = src.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "").replace(/^\//, "");
            img.src = `dawn://localhost/${cleanPath}`;
          } else {
            img.src = src;
          }
          img.style.cssText = badgeStyle;
          badgesElem.appendChild(img);
        };

        if (customs.badges?.length) {
          customs.badges.forEach((badge) => addBadge(badge));
        }
      } else {
        player.querySelector(".juice-badges")?.remove();
        nickname.style = "";
        if (playerLeft) playerLeft.style = "";
      }
    };

    const applyClanCustomizationsEsc = () => {
      const escplayers = document.querySelectorAll(".esc-interface .player-cont");
      escplayers.forEach((player) => {
        const playerIds = player.querySelector(".player-name");
        const clanElem = playerIds?.querySelector(".label");
        if (!clanElem) return;

        if (!settings.customizations) {
          clanElem.style = "color: #af51e6;";
          return;
        }
        const clan = clanElem ? clanElem.textContent.trim() : null;

        if (!clanElem) return;

        const customs = clancustomizations.find((c) => c.clan === clan);

        if (customs && customs.gradient) {
          clanElem.style.display = "flex";
          clanElem.style.flexDirection = "row";
          clanElem.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
          clanElem.style.backgroundClip = "text";
          clanElem.style.webkitBackgroundClip = "text";
          clanElem.style.color = "transparent";
          clanElem.style.fontWeight = "700";
          clanElem.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";

          if (settings.animations && customs.animated) {
            clanElem.style.backgroundSize = "200% 200%";
            clanElem.style.animation = "animated-gradient 3s linear infinite";
          }
        } else {
          clanElem.style = "color: #af51e6;";
        }
      });
    };

    const applyEscUI = () => {
      const escInterface = document.querySelector(".esc-interface");
      if (!escInterface) return;

      const escplayers = escInterface.querySelectorAll(".player-cont");
      escplayers.forEach(p => applyCustomsToPlayer(p, true));
      applyClanCustomizationsEsc();
    };

    const applyInGameUI = () => {
      const isGameUI = document.querySelector(".desktop-game-interface");
      if (!isGameUI) return;

      const observeShortIds = () => {
        const tabPlayers = document.querySelectorAll(".desktop-game-interface .player-cont");

        tabPlayers.forEach(player => {
          const shortIdElem = player.querySelector(".short-id");
          if (!shortIdElem || shortIdElem.dataset.observerAttached) return;
          shortIdElem.dataset.observerAttached = "true";

          new MutationObserver(() => {
            applyCustomsToPlayer(player, false);
          }).observe(shortIdElem, {
            characterData: true,
            subtree: true,
            childList: true
          });
        });
      };

      updatePlayerLists();
      observeShortIds();
      colorKillFeed();
      createKD();

      let tabPlayers = document.querySelectorAll(".desktop-game-interface .player-cont");
      tabPlayers.forEach(p => applyCustomsToPlayer(p, false));

      const playerListContainers = document.querySelectorAll(".game-interface .player-list");
      playerListContainers.forEach(container => {
        new MutationObserver(() => {
          tabPlayers = document.querySelectorAll(".desktop-game-interface .player-cont");
          updatePlayerLists();
          observeShortIds();
          colorKillFeed();
          applyEscUI();
          tabPlayers.forEach(p => applyCustomsToPlayer(p, false));
        }).observe(container, { childList: true });
      });
    };

    observeForElement(".kill-bar-cont", (killfeed) => {
      new MutationObserver(() => colorKillFeed()).observe(killfeed, { childList: true });
    }, document.body, true);

    observeForElement(".esc-interface", () => {
      applyEscUI();
    }, document.body, true);

    observeForElement(".desktop-game-interface", () => {
      applyInGameUI();
    }, document.body, true);
  };

  document.addEventListener("click", (e) => {
    if (e.shiftKey && e.target.classList.contains("author-name")) {
      setTimeout(() => {
        navigator.clipboard.readText().then((text) => {
          window.location.href = `${base_url}profile/${text.replace("#", "")}`;
          const username = e.target.innerText.replace(":", "");
          customNotification({
            message: `Loading ${username}${text}'s profile...`,
          });
        });
      }, 250);
    }
  });

  document.addEventListener("click", async (e) => {
    const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
    if (settings.accept_on_click) {
      const tradeElem = e.target.closest(".servers .trade");
      const tradeButtonElem = e.target.closest(".servers .trade .button");
      if (!tradeElem) return;
      if (tradeButtonElem) return;

      const boldText = tradeElem.querySelector(".bold");
      if (!boldText) return;

      const text = boldText.innerText;
      const match = text.match(/\/trade accept (\d+)/);
      if (!match) return;

      const tradeId = match[1];
      selectedTradeId = tradeId;

      tradeElem.classList.add("selected");

      const input = document.querySelector(".servers .chat .input");
      const sendBtn = document.querySelector(".servers .chat .enter");
      if (!input || !sendBtn) return;

      input.value = `/trade accept ${tradeId}`;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      sendBtn.click();
    }
  });

  const createTradeButtons = () => {
    const chatLabel = document.querySelector(".servers .chat-label");
    if (!chatLabel) return;
    if (chatLabel.parentElement.querySelector(".trade-buttons")) return;

    const container = document.createElement("div");
    container.className = "trade-buttons";
    container.style = "display: flex; gap: 0.5rem; margin-left: 1rem;";

    const makeDivButton = (label, bg, borderTop, borderBottom) => {
      const head = document.querySelector(".servers .chat-head");
      head.style.position = "relative";
      head.style.zIndex = "1";

      const div = document.createElement("div");
      div.innerText = label.toUpperCase();
      div.style = `
          cursor: pointer;
          user-select: none;
          padding: 0.2rem 1rem;
          font-size: 0.85rem;
          font-weight: 700;
          text-align: center;
          color: white;
          text-shadow: -1px -1px 0 #000, 1px -1px 0px #000, -1px 1px 1px #000, 2px 2px 0 #000;
          background: ${bg};
          border: 1px solid black;
          border-top: 3px solid ${borderTop};
          border-bottom: 3px solid ${borderBottom};
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: all 0.3s ease, opacity 0.1s ease;
        `;
      div.addEventListener("mousedown", () => {
        div.style.transform = "scale(0.95)";
        div.style.opacity = "0.85";
      });
      document.addEventListener("mouseup", () => {
        div.style.transform = "scale(1)";
        div.style.opacity = "1";
      });
      div.addEventListener("mouseenter", () => {
        div.style.background = `${borderTop}`;
      });
      div.addEventListener("mouseleave", () => {
        div.style.background = `${bg}`;
      });
      return div;
    };

    const input = document.querySelector(".servers .chat .input");
    const sendBtn = document.querySelector(".servers .chat .enter");

    const offerDiv = makeDivButton("Offer", "#3b82f6", "#60a5fa", "#1d4ed8");
    offerDiv.addEventListener("click", () => {
      if (!input) return;
      input.value = "/trade offer my:[] your:[]";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const sendMessage = (text) => {
      if (!input || !sendBtn) return;
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      sendBtn.click();
    };

    const bumpDiv = makeDivButton("Bump", "#10b981", "#34d399", "#047857");
    bumpDiv.addEventListener("click", () => {
      sendMessage("/trade bump");
    });

    const cancelDiv = makeDivButton("Cancel", "#ef4444", "#f87171", "#991b1b");
    cancelDiv.addEventListener("click", () => {
      sendMessage("/trade cancel");
    });

    container.appendChild(offerDiv);
    container.appendChild(bumpDiv);
    container.appendChild(cancelDiv);

    chatLabel.insertAdjacentElement("afterend", container);
  }

  let serversInterval = null;
  const handleServers = () => {
    if (serversInterval) clearInterval(serversInterval);

    serversInterval = setInterval(() => {
      if (!window.location.href.includes(`${base_url}servers/`)) {
        clearInterval(serversInterval);
        return;
      }

      const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
      const container = document.querySelector(".servers .trade-buttons");
      if (settings.show_trade_buttons) {
        createTradeButtons();
      } else if (container) {
        container.remove();
      }

      if (settings.accept_on_click && selectedTradeId) {
        const trades = document.querySelectorAll(".servers .trade");
        trades.forEach(t => {
          const boldText = t.querySelector(".bold");
          if (boldText && boldText.innerText.includes(`/trade accept ${selectedTradeId}`)) {
            t.classList.add("selected");
          } else {
            t.classList.remove("selected");
          }
        });
      }
    }, 500);
  };

  const injectLobbyReminder = () => {
    if (document.querySelector("#juice-keybind-reminder")) return;
    const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
    const currentBind = settings["menu_keybind"] === "ShiftRight" ? "Right Shift" : (settings["menu_keybind"] || "Right Shift");

    const keybindReminder = document.createElement("span");
    keybindReminder.id = "juice-keybind-reminder";
    keybindReminder.style = `position: absolute; left: 147px; bottom: 10px; font-size: 0.9rem; color: #fff; width: max-content`;
    keybindReminder.innerText = `Press ${currentBind} to open the client menu.`;

    const leftIcons = document.querySelector("#app #left-icons");
    if (leftIcons) {
      leftIcons.appendChild(keybindReminder);
    }

    document.addEventListener("juice-settings-changed", ({ detail }) => {
      if (detail.setting === "menu_keybind") {
        const keybindReminder = document.querySelector("#juice-keybind-reminder");
        if (keybindReminder)
          keybindReminder.innerText = `Press ${detail.value} to open the client menu.`;
      }
    });
  };



  const handleProfile = () => {
    if (profileOpened) return;
    profileOpened = true;

    const settings = JSON.parse(localStorage.getItem("dawn-settings") || "{}");
    const customizations = JSON.parse(localStorage.getItem("juice-customizations") || "[]");
    const clancustomizations = JSON.parse(localStorage.getItem("juice-clans") || "[]");

    const applyCardChanges = () => {
      const profile = document.querySelector(".tab-content > .profile-cont > .profile");
      if (!profile) return;

      const formatWithCommas = (num) => num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

      const statistics = profile.querySelectorAll(".statistic");
      const progressExp = profile.querySelector(".progress-exp");

      if (progressExp) {
        const text = progressExp.innerText;
        const parts = text.split("/");
        if (parts.length === 2) {
          const c = Number(parts[0].replace(/[^\d]/g, ""));
          const m = Number(parts[1].replace(/[^\d]/g, ""));
          if (Number.isFinite(c) && Number.isFinite(m)) {
            progressExp.innerText = `${formatWithCommas(c)}/${formatWithCommas(m)}`;
          }

        }
      }

      const statMap = {};
      statistics.forEach(stat => {
        const name = stat.querySelector(".stat-name")?.innerText?.toLowerCase();
        const valueElem = stat.querySelector(".stat-value");
        if (!name || !valueElem) return;

        const rawText = valueElem.innerText.split(" ")[0];
        if (rawText.includes(".")) return;

        const num = Number(rawText.replace(/[^\d]/g, ""));
        if (!Number.isFinite(num)) return;

        statMap[name] = { stat, valueElem, num };
        valueElem.innerText = formatWithCommas(num);
      });

      const games = statMap.games?.num ?? statMap.played?.num ?? null;
      const wins = statMap.win?.num ?? statMap.won?.num ?? null;
      const kills = statMap.kills?.num ?? null;
      const headshots = statMap.headshots?.num ?? null;

      if (wins !== null && games !== null && games > 0) {
        const rate = ((wins / games) * 100).toFixed(2) + "%";
        const elem = statMap.win?.valueElem || statMap.won?.valueElem;
        if (elem && !elem.querySelector(".winrate")) {
          elem.innerHTML += ` <span class="winrate" style="opacity: 0.6; font-size: 0.8em; margin-left: 5px;">${rate}</span>`;
        }
      }

      if (headshots !== null && kills !== null && kills > 0) {
        const rate = ((headshots / kills) * 100).toFixed(2) + "%";
        const elem = statMap.headshots?.valueElem;
        if (elem && !elem.querySelector(".headshotpercentage")) {
          elem.innerHTML += ` <span class="headshotpercentage" style="opacity: 0.6; font-size: 0.8em; margin-left: 5px;">${rate}</span>`;
        }
      }
    };

    const applyCustomizations = () => {
      const profile = document.querySelector(".tab-content > .profile-cont > .profile");
      if (!profile) return;

      const userClanElem = profile.querySelector(".clan-tag");
      const userClan = userClanElem ? userClanElem.textContent.trim() : null;
      const content = profile.querySelector(".content");

      if (settings.customizations === false) {
        const nickname = profile.querySelector(".nickname");
        const clan = profile.querySelector(".clan-tag");
        if (nickname) {
          nickname.style = "";
          nickname.querySelector(".juice-badges")?.remove();
          const span = nickname.querySelector(".nickname-span");
          if (span) span.style = "";
        }
        if (clan) clan.style = "";
        return;
      }

      if (settings.customizations !== false) {
        const shortIdElem = profile.querySelector(".card-profile .copy-cont .value");
        if (!shortIdElem) return;

        const shortId = shortIdElem.textContent.trim().split("#")[1];
        const nickname = profile.querySelector(".nickname");
        const clan = profile.querySelector(".clan-tag");

        const youElem = profile.querySelector(".you");
        if (youElem) youElem.style.width = "100%";

        if (nickname) {
          nickname.style.display = "flex";
          nickname.style.alignItems = "flex-end";
          nickname.style.gap = "0.25rem";
          nickname.style.overflow = "unset";

          const textNode = nickname.firstChild;
          if (textNode && textNode.nodeType === Node.TEXT_NODE) {
            const span = document.createElement("span");
            span.className = "nickname-span";
            span.textContent = textNode.textContent;
            nickname.replaceChild(span, textNode);
          }
        }

        profile.style.width = "unset";
        profile.style.minWidth = "60rem";
        if (content) {
          content.style.width = "36.5rem";
          content.style.flexShrink = "0";
        }

        if (!nickname.querySelector(".juice-badges")) {
          const badgesElem = document.createElement("div");
          badgesElem.style = "display: flex; gap: 0.25rem; align-items: center;";
          badgesElem.className = "juice-badges";
          nickname.appendChild(badgesElem);

          let customs = customizations.find((c) => c.shortId === shortId);

          if (settings.local_customs_enabled && shortId === localStorage.getItem("user-id")) {
            customs = {
              gradient: {
                rot: (settings.local_gradient_rot || 90) + "deg",
                stops: settings.local_gradient_colors || [],
                shadow: `0 0 ${settings.local_gradient_blur || 5}px ${settings.local_gradient_shadow_color || "#000000"}`
              },
              animated: settings.local_gradient_animated,
              badges: settings.local_badges || []
            };
          }

          if (customs) {
            const badgeStyle = "height: 32px; width: auto;";
            const span = nickname.querySelector(".nickname-span");

            if (customs.gradient && customs.gradient.stops && customs.gradient.stops.length > 0 && span) {
              span.style.display = "inline-block";
              span.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
              span.style.backgroundClip = "text";
              span.style.webkitBackgroundClip = "text";
              span.style.color = "transparent";
              span.style.fontWeight = "700";
              span.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";

              if (settings.animations !== false && customs.animated) {
                span.style.backgroundSize = "200% 200%";
                span.style.animation = "animated-gradient 3s linear infinite";
              }
            }

            if (customs.badges) {
              customs.badges.forEach(badge => {
                const img = document.createElement("img");
                if (badge.startsWith("/") || badge.match(/^[A-Za-z]:\\/)) {
                  const cleanPath = badge.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "").replace(/^\//, "");
                  img.src = `dawn://localhost/${cleanPath}`;
                } else {
                  img.src = badge;
                }
                img.style = badgeStyle;
                badgesElem.appendChild(img);
              });
            }
          }
        }

        if (userClan && settings.customizations !== false) {
          const customs = clancustomizations.find((c) => c.clan === userClan);
          if (customs && customs.gradient && clan) {
            clan.style.display = "inline-block";
            clan.style.background = `linear-gradient(${customs.gradient.rot}, ${customs.gradient.stops.join(", ")})`;
            clan.style.backgroundClip = "text";
            clan.style.webkitBackgroundClip = "text";
            clan.style.color = "transparent";
            clan.style.fontWeight = "700";
            clan.style.textShadow = customs.gradient.shadow || "0 0 0 transparent";

            if (settings.animations !== false && customs.animated) {
              clan.style.backgroundSize = "200% 200%";
              clan.style.animation = "animated-gradient 3s linear infinite";
            }
          }
        }
      }
    };

    let profileInterval = null;
    const run = () => {
      if (profileInterval) clearInterval(profileInterval);
      profileInterval = setInterval(() => {
        applyCustomizations();
        applyCardChanges();
      }, 250);
    };

    run();
    observeForElement(".profile-cont", run);
    observeForElement(".tab-content", run);
  };

  const handleMarket = () => {
  };

  const handleClans = () => {
  };

  const handleInventory = () => {
  };

  let lastUrl = window.location.href;
  const checkUrlChange = () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      handleUrlChange(currentUrl);
    }
  };

  const originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(this, arguments);
    checkUrlChange();
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(this, arguments);
    checkUrlChange();
  };
  window.addEventListener("popstate", checkUrlChange);

  const handleUrlChange = (url) => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.info = originalConsole.info;
    console.trace = originalConsole.trace;

    if (url === `${base_url}` || url === `${base_url}#` || url.split("?")[0] === base_url) {
      handleLobby();
    } else if (url.startsWith(`${base_url}games`)) {
      handleInGame();
    } else if (url.includes(`hub/ranked/leaderboard`)) {
      handleInGame();
    } else if (url.includes(`${base_url}servers/`)) {
      handleServers();
    } else if (url.includes(`${base_url}profile/`)) {
      handleProfile();
    } else if (url.includes(`hub/market`)) {
      handleMarket();
    } else if (url.includes(`hub/clans`)) {
      handleClans();
    } else if (url.includes(`friends`)) {
      handleFriends();
    } else if (url.includes(`inventory`)) {
      handleInventory();
    }
  };

  const handleInitialLoad = () => {
    const url = window.location.href;
    handleUrlChange(url);
  };

  const observeForElement = (selector, functionToRun, target = document.body, persistent = false) => {
    if (!target) {
      console.warn("Target element not available");
      return null;
    }

    const existing = target.querySelector(selector);
    if (existing) {
      functionToRun(existing);
      if (!persistent) return null;
    }

    const observer = new MutationObserver((mutations, obs) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches(selector)) {
                if (!persistent) obs.disconnect();
                functionToRun(node);
              } else {
                const inner = node.querySelector(selector);
                if (inner) {
                  if (!persistent) obs.disconnect();
                  functionToRun(inner);
                }
              }
            }
          });
        }
      }
    });

    observer.observe(target, { childList: true, subtree: true });
    return observer;
  };

  // PORTED FROM CHEESEBURGERS CONSOLE SCRIPT:

  function initChestOpener(menu) {
    const select = menu.querySelector("#chest-opener-select");
    const stopBtn = menu.querySelector("#chest-opener-stop-btn");

    if (!select || !stopBtn) return;

    let activeOpenerInterval = null;
    const opener_list = "https://raw.githubusercontent.com/zVipexx/dawn-client/refs/heads/main/openerlist.json";
    const git_base = "Cheeseybowrger";

    const fetchOpenerList = async () => {
      try {
        const res = await fetch(opener_list);
        if (!res.ok) throw new Error("Failed to fetch opener list");
        return await res.json();
      } catch (e) {
        console.error(e);
        return null;
      }
    };

    const populateList = async () => {
      const data = await fetchOpenerList();
      if (!data) {
        select.innerHTML = "<option disabled>Failed to load</option>";
        return;
      }

      select.innerHTML = '<option value="none">None</option>';

      const chestGroup = document.createElement("optgroup");
      chestGroup.label = "Chests:";

      const allChests = document.createElement("option");
      allChests.value = "Chest_All";
      allChests.textContent = "All Chests";
      chestGroup.appendChild(allChests);

      data.chests.forEach((chest) => {
        const opt = document.createElement("option");
        opt.value = `Chest_${chest.name}`;
        opt.textContent = chest.name;
        chestGroup.appendChild(opt);
      });
      select.appendChild(chestGroup);

      const cardGroup = document.createElement("optgroup");
      cardGroup.label = "Cards:";

      const allCards = document.createElement("option");
      allCards.value = "Card_All";
      allCards.textContent = "All Cards";
      cardGroup.appendChild(allCards);

      data.cards.forEach((card) => {
        const opt = document.createElement("option");
        opt.value = `Card_${card.name.replace(/\s+/g, "")}`;
        opt.textContent = card.name;
        cardGroup.appendChild(opt);
      });
      select.appendChild(cardGroup);

      select.addEventListener("change", () => {
        if (activeOpenerInterval) {
          clearInterval(activeOpenerInterval);
          activeOpenerInterval = null;
        }

        const value = select.value;
        if (value === "none") return;

        if (value === "Chest_All") return executeChestScript(data.chests);
        if (value.startsWith("Chest_")) {
          const name = value.replace("Chest_", "");
          const chest = data.chests.find((c) => c.name === name);
          if (chest) return executeChestScript([chest]);
        }
        if (value === "Card_All") return executeCardScript(data.cards);
        if (value.startsWith("Card_")) {
          const name = value.replace("Card_", "");
          const card = data.cards.find((c) => c.name.replace(/\s+/g, "") === name);
          if (card) return executeCardScript([card]);
        }
      });
    };

    stopBtn.addEventListener("click", () => {
      if (activeOpenerInterval) {
        clearInterval(activeOpenerInterval);
        activeOpenerInterval = null;
      }
      ingameShowcase_messages("Opener Stopped", 2000);
      select.value = "none";
    });

    const coloroutput = {
      PARANORMAL: "000000",
      MYTHICAL: "c20025",
      LEGENDARY: "feaa37",
      EPIC: "cd2afc",
      RARE: "43abde",
      COMMON: "47f2a0",
      DEFAULT: "ffffff",
    };

    function ingameShowcase_messages(message, displaylength) {
      try {
        const group = document.getElementsByClassName("vue-notification-group")[0];
        if (!group) return;
        const elem = document.createElement("div");
        elem.classList = "vue-notification-wrapper";
        elem.style = "transition-timing-function: ease; transition-delay: 0s; transition-property: all;";
        elem.innerHTML = `<div data-v-3462d80a="" data-v-460e7e47="" class="alert-default"><span data-v-3462d80a="" class="text">${message}</span></div>`;
        elem.onclick = function () {
          try { elem.remove(); } catch { }
        };
        group.children[0].appendChild(elem);
        setTimeout(() => {
          try { elem.remove(); } catch { }
        }, displaylength);
      } catch (e) { }
    }

    function ingameShowcase(message, rarity, name, translations, bvl) {
      const displayRarity = translations[rarity] || rarity_backup(bvl, "Skin Name", "Rarity", name) || "Unknown";

      const text = `${displayRarity} ${message} from: ${name}`;
      const color = coloroutput[displayRarity.toUpperCase()] || coloroutput.DEFAULT;

      console.log(`%c${text}`, `color: #${color}`);

      try {
        const group = document.getElementsByClassName("vue-notification-group")[0];
        if (!group) return;
        const elem = document.createElement("div");
        elem.classList.add("vue-notification-wrapper");
        elem.style = "transition-timing-function: ease; transition-delay: 0s; transition-property: all;";
        elem.innerHTML = `<div data-v-3462d80a="" data-v-460e7e47="" class="alert-default"><span data-v-3462d80a="" class="text" style="color:#${color}">${text}</span></div>`;
        elem.onclick = function () {
          try { elem.remove(); } catch { }
        };
        group.children[0].appendChild(elem);
        setTimeout(() => {
          try { elem.remove(); } catch { }
        }, 5000);
      } catch (e) { }
    }

    function rarity_backup(spreadsheet, namefield, rarityfield, skinname) {
      let found = false;
      let rarity = "Unknown-Rarity";
      spreadsheet.forEach((listitem) => {
        if (listitem && listitem[namefield] && listitem[rarityfield]) {
          if (
            found == false &&
            listitem[namefield] == skinname &&
            Object.keys(coloroutput).includes(listitem[rarityfield].toUpperCase())
          ) {
            found = true;
            rarity = listitem[rarityfield];
          }
        }
      });
      return rarity;
    }

    function confettiAnimation() {
      if (typeof confetti === "function") {
        const duration = 15 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

        const interval = setInterval(() => {
          const timeLeft = animationEnd - Date.now();
          if (timeLeft <= 0) { clearInterval(interval); return; }
          const particleCount = 50 * (timeLeft / duration);
          confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.2 + 0.1, y: Math.random() - 0.2 }, zIndex: 99999 });
          confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.2 + 0.7, y: Math.random() - 0.2 }, zIndex: 99999 });
        }, 250);
      }
    }

    async function executeChestScript(customchestlist) {
      if (!localStorage.token) {
        ingameShowcase_messages("Please log in first!", 3000);
        return;
      }

      let chests = customchestlist;
      let openingdelay = 2000;

      let translations_req = await fetch(`https://raw.githubusercontent.com/${git_base}/KirkaScripts/refs/heads/main/ConsoleScripts/microwaves.json`);
      let translations = await translations_req.json();
      Object.keys(translations).forEach((item) => {
        let translationItem = translations[item];
        translations[translationItem] = item;
      });

      let response = await fetch(`https://api2.kirka.io/api/${translations["inventory"]}`, {
        headers: { accept: "application/json", authorization: `Bearer ${localStorage.token}` },
      });
      let inventory = await response.json();

      let bvl = await fetch("https://opensheet.elk.sh/1tzHjKpu2gYlHoCePjp6bFbKBGvZpwDjiRzT9ZUfNwbY/Alphabetical").then(r => r.json());

      inventory.forEach((item) => {
        Object.keys(item).forEach((key) => { if (typeof item[key] == "object") translations["item"] = key; });
      });
      inventory.forEach((item) => {
        Object.keys(item[translations["item"]]).forEach((key) => {
          if ((typeof item[translations["item"]][key] == "string" && item[translations["item"]][key] == "Elizabeth") || item[translations["item"]][key] == "James") translations["name"] = key;
        });
      });
      inventory.forEach((item) => {
        Object.keys(item[translations["item"]]).forEach((key) => {
          if ((typeof item[translations["item"]][key] == "string" && item[translations["item"]][key] == "a1055b22-18ca-4cb9-8b39-e46bb0151185") || item[translations["item"]][key] == "6be53225-952a-45d7-a862-d69290e4348e") translations["id"] = key;
        });
      });

      let chestskipper = new Array(chests.length).fill(2);
      try { chestskipper[0] = 0; } catch { }

      try {
        inventory.forEach((item) => {
          for (let i = 0; i < chests.length; i++) {
            if (item[translations["item"]][translations["id"]] == chests[i]["chestid"]) {
              chestskipper[i] = 0;
            }
          }
        });
      } catch { }

      if (!document.getElementById("konfettijs")) {
        let script = document.createElement("script");
        script.id = "konfettijs";
        script.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";
        document.head.appendChild(script);
      }

      let counter = 0;
      activeOpenerInterval = setInterval(async () => {
        let bodyobj = {};
        bodyobj[translations["id"]] = chests[counter]["chestid"];
        const response = await fetch(`https://api2.kirka.io/api/${translations["inventory"]}/${translations["openChest"]}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${localStorage.token}`,
            "content-type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify(bodyobj),
        });
        let chestresult = await response.json();

        let resultName = chestresult[translations["name"]];
        let resultRarity = chestresult[translations["rarity"]];

        if (resultName) {
          ingameShowcase(resultName, resultRarity, chests[counter]["name"], translations, bvl);
          if (translations[resultRarity] == "MYTHICAL" || translations[resultRarity] == "PARANORMAL") {
            confettiAnimation();
          }
        } else if (chestresult["code"] == 9910) {
          console.log("RATELIMIT");
        } else {
          chestskipper[counter]++;
        }

        counter = (counter + 1) % chests.length;
        while (chestskipper[counter] >= 2) {
          counter = (counter + 1) % chests.length;
          let check = chestskipper.reduce((acc, val) => acc + val, 0);
          if (check == chestskipper.length * 2) {
            counter = 0;
            break;
          }
        }

        let check = chestskipper.reduce((acc, val) => acc + val, 0);
        if (check == chestskipper.length * 2) {
          clearInterval(activeOpenerInterval);
          activeOpenerInterval = null;
          ingameShowcase_messages("Finished Running Chest Opener", 5000);
          select.value = "none";
        }
      }, openingdelay);
    }

    async function executeCardScript(customcardlist) {
      if (!localStorage.token) {
        ingameShowcase_messages("Please log in first!", 3000);
        return;
      }
      let cards = customcardlist;
      let openingdelay = 2000;

      let translations_req = await fetch(`https://raw.githubusercontent.com/${git_base}/KirkaScripts/refs/heads/main/ConsoleScripts/microwaves.json`);
      let translations = await translations_req.json();
      Object.keys(translations).forEach((item) => {
        let translationItem = translations[item];
        translations[translationItem] = item;
      });

      let response = await fetch(`https://api2.kirka.io/api/${translations["inventory"]}`, {
        headers: { accept: "application/json", authorization: `Bearer ${localStorage.token}` },
      });
      let inventory = await response.json();
      let bvl = await fetch("https://opensheet.elk.sh/1tzHjKpu2gYlHoCePjp6bFbKBGvZpwDjiRzT9ZUfNwbY/Alphabetical").then(r => r.json());

      inventory.forEach((item) => {
        Object.keys(item).forEach((key) => { if (typeof item[key] == "object") translations["item"] = key; });
      });
      inventory.forEach((item) => {
        Object.keys(item[translations["item"]]).forEach((key) => {
          if ((typeof item[translations["item"]][key] == "string" && item[translations["item"]][key] == "Elizabeth") || item[translations["item"]][key] == "James") translations["name"] = key;
        });
      });
      inventory.forEach((item) => {
        Object.keys(item[translations["item"]]).forEach((key) => {
          if ((typeof item[translations["item"]][key] == "string" && item[translations["item"]][key] == "a1055b22-18ca-4cb9-8b39-e46bb0151185") || item[translations["item"]][key] == "6be53225-952a-45d7-a862-d69290e4348e") translations["id"] = key;
        });
      });

      let cardskipper = new Array(cards.length).fill(2);
      try { cardskipper[0] = 0; } catch { }

      try {
        inventory.forEach((item) => {
          for (let i = 0; i < cards.length; i++) {
            if (item[translations["item"]][translations["id"]] == cards[i]["cardid"]) {
              cardskipper[i] = 0;
            }
          }
        });
      } catch { }

      if (!document.getElementById("konfettijs")) {
        let script = document.createElement("script");
        script.id = "konfettijs";
        script.src = "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";
        document.head.appendChild(script);
      }

      let counter = 0;
      activeOpenerInterval = setInterval(async () => {
        let bodyobj = {};
        bodyobj[translations["id"]] = cards[counter]["cardid"];
        const response = await fetch(`https://api2.kirka.io/api/${translations["inventory"]}/${translations["openCharacterCard"]}`, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${localStorage.token}`,
            "content-type": "application/json;charset=UTF-8",
          },
          body: JSON.stringify(bodyobj),
        });
        let json = await response.json();
        let cardresult = {};
        Array.from(json).forEach((item) => {
          Object.keys(item).forEach((key) => {
            if (typeof item[key] == "boolean" && item[key] == true) {
              cardresult = item;
            }
          });
        });

        let resultName = cardresult[translations["name"]];
        let resultRarity = cardresult[translations["rarity"]];

        if (resultName) {
          ingameShowcase(resultName, resultRarity, cards[counter]["name"], translations, bvl);
          if (translations[resultRarity] == "MYTHICAL" || translations[resultRarity] == "PARANORMAL") {
            confettiAnimation();
          }
        } else if (cardresult["code"] == 9910) {
          console.log("RATELIMIT");
        } else {
          cardskipper[counter]++;
        }

        counter = (counter + 1) % cards.length;
        while (cardskipper[counter] >= 2) {
          counter = (counter + 1) % cards.length;
          let check = cardskipper.reduce((acc, val) => acc + val, 0);
          if (check == cardskipper.length * 2) {
            counter = 0;
            break;
          }
        }

        let check = cardskipper.reduce((acc, val) => acc + val, 0);
        if (check == cardskipper.length * 2) {
          clearInterval(activeOpenerInterval);
          activeOpenerInterval = null;
          ingameShowcase_messages("Finished Running Card Opener", 5000);
          select.value = "none";
        }
      }, openingdelay);
    }

    populateList();
  }

  const fetchAll = async () => {
    try {
      const [customizations, clan] = await Promise.all([
        fetch("https://raw.githubusercontent.com/zVipexx/dawn-client/refs/heads/main/badges.json")
          .then((r) => r.json()),
        fetch("https://raw.githubusercontent.com/zVipexx/dawn-client/refs/heads/main/clans.json")
          .then((r) => r.json()),
      ]);

      localStorage.setItem("juice-customizations", JSON.stringify(customizations));
      localStorage.setItem("juice-clans", JSON.stringify(clan));
    } catch (err) {
      console.error("Failed to fetch customizations", err);
    }
  };

  fetchAll();
  handleInitialLoad();

  document.addEventListener("dawn-settings-changed", () => {
    handleUrlChange(window.location.href);
  });

})();
