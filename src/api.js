const express = require('express');

const {
    readJsonFrom_FilePath,
    getTagsFromJSON,
    getFilteredTags
} = require('./backend');

const app = express();

const PORT = 3000;


// JSON completo
app.get('/json', (req, res) => {

    const json = readJsonFrom_FilePath();

    res.json(json);
});


// Todos los tags
app.get('/tags', (req, res) => {

    const json = readJsonFrom_FilePath();

    const tags = getTagsFromJSON(json);

    res.json(tags);
});


// Tags filtrados
app.get('/filtered-tags', (req, res) => {

    const filt = req.query.valueSource;

    const json = readJsonFrom_FilePath();

    const tags = getTagsFromJSON(json);

    const filtered =
        getFilteredTags(tags, filt);

    res.json(filtered);
});


app.listen(PORT, () => {

    console.log(`Servidor en puerto ${PORT}`);
});