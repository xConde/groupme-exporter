# GroupMe Exporter

This is a Node.js script that downloads all media files (photos and videos) from a GroupMe conversation and saves them to the local filesystem. The script uses the GroupMe API to fetch the conversation history and download the media files. It also supports saving the chat history to a text file.

## Requirements

- Node.js v14 or later
- Yarn package manager
- A GroupMe API access token

## Installation

1. Clone this repository or download the source code.
2. Install dependencies by running `yarn install` in the project directory.

## Usage

1. Obtain a GroupMe API access token from https://dev.groupme.com/.
2. Run the script with `yarn start`.
3. Follow the prompts to select a conversation, choose an output directory, and specify whether to save the chat history.

The script will download all media files from the selected conversation and save them to the specified output directory. If you choose to save the chat history, the script will also create a text file containing the full chat history.

## Options

The following options are available when running the script:

- `--help`: Print help information and exit.
- `--version`: Print version information and exit.

## License

This script is licensed under the MIT License. See the LICENSE file for more information.
