# [DISCONTINUED]
Please use https://github.com/zVipexx/dawn-client


# 🚀 Dawn Client v2

A lightweight **unofficial desktop client for Kirka.io**, built with **Tauri** and focused on performance, user customization and quality of life features.

This project is community-made and not affiliated with kirka.io.

---

## ✨ Core Features

### Performance

* Lightweight Tauri backend (no bundled Chromium)
* Lower CPU usage than Electron-based clients
* Fast startup time

### Client Features

* Built-in Gallery for quick and easy file access
* Real-time calculated Maximum FPS
* Discord Rich Presence
* Custom userscripts
* Chest Opener

### Quality of Life

* Click to accept trade (with confirmation)
* Customizable killfeed colors by team
* Spectate Friend button
* Room Creation presets
* Trade action buttons

### Customization

* Permanent Scoreboard
* Local Customizations
* Resource Swapping
* Menu Theme color
* Custom CSS

---

## 📥 Download & Installation

As of release, Dawn Client v2 will only feature Windows support. Linux and macOS are expected in the future, although they can be built from source and will likely pose bugs.

### Download prebuilt client

1. Open the [**GitHub Releases**](https://github.com/zVipexx/dawn-client-v2/releases) page
2. Download the installer for your operating system:

   * **Windows**: `.msi`
   * **macOS**: coming soon (maybe)
   * **Linux**: coming soon (maybe)
3. Run the installer and launch the client

### Build from source

#### Requirements

* Node.js
* Rust
* Tauri system dependencies for your OS

#### Build Steps

```bash
git clone https://github.com/zVipexx/dawn-client-v2.git
cd dawn-client-v2
npm install
npm run tauri build
```
> The installer will be available in the `src-tauri/target/release/bundle` directory
---

## 🔒 Safety & Open Source

This client is **fully open source**.

* All source code is publicly available on GitHub
* Builds are done through Github Actions
* Builds can be compiled locally
* No credentials are stored outside the official Kirka session

Security is based on transparency. You are free to audit, fork, or modify the client.

---

## ⚠️ Disclaimers

* This is an **unofficial client** and is not endorsed by or affiliated with kirka.io. Use responsibly and follow Kirka’s terms of service.
* Due to tauri restrictions, Dawn Client v2 is not able to load paths to files. When detecting a direct path, the client will prompt you to convert it to a base64 string.
* The "Unlimited FPS" setting has been removed to prevent resource overuse. This will not have any negative impact on your game, as it will continue to run at the highest refresh rate your monitor allows. Instead, your potential FPS are now being displayed inside of the native Info HUD.
* **Any** usage of third-party userscripts comes with the risk of triggering the anticheat.

### Known incompatibilities with userscripts:

* Multiple false bans were most likely caused by the Custom Skin Link userscript, use at your own risk.

---

## ⌨️ Default Keybinds

| Key | Action |
| --- | --- |
| Esc | Close menu |
| RShift | Open client menu |
| F5 | Reload game |
| F6 | Load URL |
| F11 | Toggle fullscreen |
| F12 | Toggle developer tools |

---

## 📦 Resource Swapping

1. Locate the Resource Swap section in the Client tab
2. Select the asset to be replaced
3. Upload a replacement file
4. Restart the client to apply changes

Only the default skins of weapons are affected.

---

## 🎨 Local Customizations

Dawn Client allows you to add your own gradient and badges to the client, which only you can see.
Public gradients are explicitly for big influences to the game.

### How to add a gradient

1. Navigate to the Scripts tab and enable the Local Customizations section
2. Add at least 2 colors to the gradient
3. Adjust the settings to your liking
4. Refresh the client to apply changes

> When using an animated gradient, reuse the first color as the last for a smooth transition.

### How to add a badge

1. Input a link to the image you want to use
2. Refresh the client to apply changes

---

## 📄 License

This project is licensed under the GNU General Public License v3.
See the `LICENSE` file for details.

---

## ♥️ Credits

* Cheeseburger for the reworked Chest Opener script
