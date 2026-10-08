"use strict";

const Client = require("ssh2-sftp-client");
const path = require('path');
require("dotenv").config();

const config = {
  host: process.env.SFTP_HOST,
  port: process.env.SFTP_PORT,
  username: process.env.SFTP_USER,
  password: process.env.SFTP_PASSWORD
};

const sftpPath = process.env.SFTP_SPECIFIC_PATH || '';

const uploadData = async () => {
    const sftpClient = new Client();
    try {
        await sftpClient.connect(config)
        sftpClient.on("upload", info => {
            console.log(`Listener: Uploaded ${info.source}`);
        });

        const root_dir = await sftpClient.cwd();
        const localFile = path.join(__dirname, "..", "_site") + "/index.html";
        const remoteFile = `${root_dir + sftpPath}/index.html`
        
        await sftpClient.fastPut(localFile, remoteFile);

        const localBitmapFile = path.join(__dirname, "..", "_site") + "/bitmap.jpg";
        const remoteBitmapFile = `${root_dir + sftpPath}/bitmap.jpg`
        await sftpClient.fastPut(localBitmapFile, remoteBitmapFile);
    } catch (err) {
        console.error(err);
    } finally {
        sftpClient.end();
    }
};

uploadData();

