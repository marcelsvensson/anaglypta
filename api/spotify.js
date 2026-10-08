const axios = require("axios");
const qs = require("qs");
require("dotenv").config();

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;
const playlist_id = process.env.PLAYLIST_ID;

const authToken = new Buffer.from(client_id + ":" + client_secret).toString(
  "base64"
);

let access_token;

const getAuth = async () => {
  if (access_token) {
    return access_token;
  }
  try {
    const token_url = "https://accounts.spotify.com/api/token";
    const data = qs.stringify({ grant_type: "client_credentials" });

    const response = await axios.post(token_url, data, {
      headers: {
        Authorization: `Basic ${authToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
    access_token = response.data.access_token;
    return access_token;
  } catch (error) {
    console.log(error);
  }
};

const getArtist = async (id) => {
  const token = await getAuth();

  const url = `https://api.spotify.com/v1/artists/${id}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (response.ok) {
    const json = await response.json();
    return json;
  } else {
    console.log("Failed...", response);
  }
};

const getPlaylist = async (offset = 0) => {
  const token = await getAuth();
  const formData = {
    "market": "SE",
    "fields": "items(added_at,track(id,name,album(artists(name,id),name,id,release_date,images(url))))",
    offset
  }
  try {
    const data = qs.stringify(formData);
    const playlist_url = `https://api.spotify.com/v1/playlists/${playlist_id}/tracks?${data}`;

    const response = await axios.get(playlist_url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const playlist = response.data;
    return playlist;
  } catch (error) {
    console.log('❌', error);
  }
};

module.exports = {
    getArtist,
    getPlaylist
}