const path = require('path');

function readJsonFrom_FilePath(fp = 'testCase/tags.json') {
    const fs = require('fs');

    try {
        const data = fs.readFileSync(fp, 'utf8');
        return JSON.parse(data);
    }
    catch (error) {
        console.error('Error leyendo JSON:', error);
        return null;
    }
}

function getTagsFromJSON(full_json, head = "") {
    let tags;
    let miJson = full_json;


    if (miJson.tagType == "Provider") {
        miJson = miJson.tags;
        miJson = miJson.filter(item => item.name != '_types_');
        head = "[tagProvider]"

    }
    tags = [];

    for (const item of miJson) {
        fp = (head == "[tagProvider]") ? head + item.name : head + "/" + item.name;

        if (item.tagType == "AtomicTag") {
            item.fullPath = fp;
            tags.push(item);
        }

        else {   //Es una carpeta:
            mjs = getTagsFromJSON(item.tags, fp);
            tags = tags.concat(mjs)
        }
    }

    return tags;
}

function getTagsFromJSON_Filtered(tags, filter){
    let filteredTags    = tags.filter(item => item.valueSource == filter);
    return filteredTags
}

function translateDtype(dtype){
    switch (dtype) {
        case "Int1":
        case "Boolean":
            return "boolean";

        case "Int2":
        case "Int4":
        case "Int8":
            return "int32";


        case "Float4":
            return "float";

        case "Float8":
            return "double";

        case "String":
        case "Text":
            return "string";

        case "DateTime":
            return "datetime";


        default:
            throw new Error(`Tipo desconocido: ${dtype}`);
    }
}

function getOPCData(full_json){
    let OPCData = getTagsFromJSON_Filtered(full_json, "opc");
    let Devices = {};

    for (const item of OPCData) {
       
        
        let opcPath = String(item.opcItemPath);

        if (opcPath.includes("[Diagnostics]")) {
            continue;
        }

        let opcTag = opcPath.split(']')[-1];
        let controlador = opcPath.split(']')[0].split('[')[1];

        if (!(controlador in Devices)) {
            Devices[controlador] = [];
        }
        
        newItem = {
            "Time Interval": 0,
            "Value Source": {min: 0, max: 0, period: 100, repeat: 0, tp: "ramp"},
            "Browse Path": opcTag,
            "Data Type": translateDtype(item.dataType)
        }

        Devices[controlador].push(newItem);


    }

    return Devices;
}

let json            = readJsonFrom_FilePath();
let tags            = getTagsFromJSON(json);
let filteredTags    = getOPCData(tags);

console.log(filteredTags);
