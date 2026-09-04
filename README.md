# Duolingo Chess History

Browser extension that allows you to export your Duolingo Chess games as PGN files.


## Features

- Export individual games as `.pgn`
- Copy games directly as PGN
- Converts Duolingo's UCI move history to standard chess notation
- Works directly from the Duolingo Chess match history
- Supports Firefox and Chromium-based browsers

## Installation

### Firefox

1. Clone the repository:
    ```
    git clone https://github.com/JohnVitor-Dev/duolingo-chess-history.git
    ```
2. Open Firefox and go to: `about:debugging#/runtime/this-firefox`.
3. Click Load Temporary Add-on...
4. Select the `manifest.json` file from the cloned repository.
5. Open https://www.duolingo.com/chess-matches.
6. The **Export PGN** and **Copy PGN** buttons will appear on your games.
>Note: Firefox loads the extension temporarily. It will be removed when Firefox is restarted.
>Firefox does not support loading unpacked extensions permanently.

### Chromium-based browsers

1. Clone the repository:
    ```
    git clone https://github.com/JohnVitor-Dev/duolingo-chess-history.git
    ```
2. Open the browser's extension page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
   - Opera: `opera://extensions/`
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the cloned repository.
5. Open https://www.duolingo.com/chess-matches.
6. The **Export PGN** and **Copy PGN** buttons will appear on your games.

## Credits

This project uses [chess.js](https://github.com/jhlywa/chess.js) for chess move validation and UCI to SAN conversion.

## Status

MVP complete.
Tested with Firefox and Chromium Based Browsers.

## Disclaimer

This project is an independent browser extension and is not affiliated with or endorsed by Duolingo.

The extension interacts with data exposed by Duolingo Chess through the browser. Changes to Duolingo's website or internal APIs may cause the extension to stop working.

## License

This project is licensed under the MIT License. See the LICENSE file for details.