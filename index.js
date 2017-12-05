#!/usr/bin/env echo --max-old-space-size=8096
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

require('v8').setFlagsFromString('--max_old_space_size=8096');
require('object.values').shim();

const http = require("http"),
      https = require("https"),
      util = require('util'),
      cwd = process.cwd(),
      fs = require('fs'),
      extend = require('extend'),
      async = require('async'),
      StringDecoder = require('string_decoder').StringDecoder,
      decoder = new StringDecoder('utf8'),
      xml2js = require('xml2js'),
      abc = "A,B,C,D,E,F,G,H,I,J,K,L,M,N,O,P,Q,R,S,T,U,V,W,X,Y,Z".split(","),
      htmlToText = require('html-to-text'),
      ctrCommonCert = {
          key: fs.readFileSync(__dirname + "/ctr-common-key.pem"),
          cert: fs.readFileSync(__dirname + "/ctr-common.pem")
      };

var languages = [],
    titleIDs = parseJsonFile(cwd + "/titles.json") || {},
    eShopUIDs = parseJsonFile(cwd + "/eshopuid.json") || {},
    titleData = parseJsonFile(cwd + "/complete.json") || {},
    deviceTypes = [],
    publishers = parseJsonFile(cwd + "/publishers.json") || {},
    platforms = parseJsonFile(cwd + "/platforms.json") || {},
    foundeShopUIDs = [];

function parseJsonFile(path){
    if(fs.existsSync(path)){
        var fileData = decoder.write(fs.readFileSync(path));
        return JSON.parse(fileData);
    }
    return null;
}

function firstOrNone(input){
    if(input && input.length > 0){
        return input[0];
    }
    return null;
}

function getNinjaURL(path, callback){
    var req = https.request({
        key: ctrCommonCert.key,
        cert: ctrCommonCert.cert,
        rejectUnauthorized: false,
        host: 'ninja.ctr.shop.nintendo.net',
        path: path,
        port: 443
    }, (res) => {
        var data = '';
        
        res.on('data', (d) => {
            data += d;
        });
        
        res.on('end', () => {
            callback(data, null);
        });
    }).on('error', (error) => {
        getNinjaURL(path, callback);
        //callback(null, error);
    });
	req.shouldKeepAlive = false;
	req.end();
}

var langDiscQueue = async.queue((lang, callback) => {
    var req = https.get("https://samurai.wup.shop.nintendo.net/samurai/ws/" + lang + "/titles?limit=9999999", (res) => {
        var data = ''
        res.on('data', (d) => {
            data += d;
        });
        
        res.on('end', () => {
            if(data.indexOf("<error>") == -1){
                var parser = new xml2js.Parser();
                parser.parseString(data, (err, result) => {
                    if(err){
                        callback(err);
                    } else {
                        handleSamuraiListXML(lang, result, callback);
                        handleSamuraiPublisherPlatformList(lang, "publisher");
                        handleSamuraiPublisherPlatformList(lang, "platform");
                    }
                });
            } else {
                callback();
            }
        })
    }).on('error', () => {
        langDiscQueue.push(lang);
        callback();
    });
	req.shouldKeepAlive = false;
	req.end();
}, 10);

langDiscQueue.pause();
for(var x = 0; x < abc.length; x++){
    for(var y = 0; y < abc.length; y++){
        langDiscQueue.push(abc[x] + abc[y]);
    }
}
langDiscQueue.drain = () => {
    var IDs = Object.values(eShopUIDs);
    
    for(var x = 0; x < IDs.length; x++){
        if(foundeShopUIDs.indexOf(IDs[x]) == -1){
            for(var y = 0; y < languages.length; y++){
                samuraiTitleQueue.push({
                    language: languages[y],
                    eshop_id: IDs[x]
                });
                console.log("Pushed " + IDs[x] + " > " + languages[y]);
            }
        }
    }
    samuraiTitleQueue.resume();
};
langDiscQueue.resume();

function handleSamuraiPublisherPlatformList(lang, type){
    //https://samurai.ctr.shop.nintendo.net/samurai/ws/JP/publishers/?shop_id=2
    var req = https.get("https://samurai.ctr.shop.nintendo.net/samurai/ws/" + lang + "/" + type + "s/?shop_id=2", (res) => {
        var data = ''
        res.on('data', (d) => {
            data += d;
        });
        
        res.on('end', () => {
            if(data.indexOf("<error>") == -1){
                var parser = new xml2js.Parser();
                parser.parseString(data, (err, result) => {
                    if(!err){
                        console.log(lang + " > " + type + "s");
                        for(var i = 0, iLength = parseInt(result.eshop[type + "s"][0]["$"]["length"]); i < iLength; i++){
                            var obj = result.eshop[type + "s"][0][type][i],
                                id = parseInt(obj["$"].id),
                                category = parseInt(obj["$"].category),
                                device = obj["$"].device,
                                name = obj.name[0];
                            
                            if(type == "platform"){
                                if(platforms[id] == null){
                                    platforms[id] = {
                                        id: id,
                                        device: device,
                                        category: category,
                                        name: {}
                                    }
                                }
                                platforms[id].name[lang] = name;
                            }
                            if(type == "publisher"){
                                if(publishers[id] == null){
                                    publishers[id] = {
                                        id: id,
                                        name: {}
                                    }
                                }
                                publishers[id].name[lang] = name;
                            }
                            
                        }
                    }
                });
            }
        })
        
        
    }).on('error', () => {
        handleSamuraiPublisherPlatformList(lang, type);
    });
	req.shouldKeepAlive = false;
	req.end();
}

function handleSamuraiListXML(lang, result, callback){
    var contents = result.eshop.contents[0].content;
    var titleInfo;
    console.log("Samurai List: " + lang);
    if(parseInt(result.eshop.contents[0]["$"].length) > 0){
        languages.push(lang);
        for(var i = 0; i < contents.length; i++){
            titleInfo = contents[i].title[0];
            if(foundeShopUIDs.indexOf(titleInfo["$"].id) == -1){
                foundeShopUIDs.push(titleInfo["$"].id);
            }
            samuraiTitleQueue.push({
                language: lang,
                eshop_id: titleInfo["$"].id
            });
        }
    }
    callback();
}

var samuraiTitleQueue = async.queue((input, callback) => {
    var info = {
        title_id: null
    };
    
    
    
    console.log(input.language + " > " + input.eshop_id)
    var ninjaAttempts = 0;
    var samuraiAttempts = 0;
    
    async.parallel([
        function(callback){
            var ninjaFetch = arguments.callee;
            
            // get ninja info
            getNinjaURL("/ninja/ws/" + input.language + "/title/" + input.eshop_id + "/ec_info", (data, error) => {
                ninjaAttempts++;
                if(error == null){
                    var parser = new xml2js.Parser();
                    parser.parseString(data, (err, result) => {
                        if(!err){
                            if(result == undefined || result.eshop == undefined || result.eshop.title_ec_info == undefined || result.eshop.title_ec_info[0].title_id == undefined){
                                
                            } else {
                                info.title_id = result.eshop.title_ec_info[0].title_id[0];
                            }
                        } else {
                            console.error(err);
                        }
                        callback(err);
                    });
                } else {
                    if(ninjaAttempts < 6){
                        ninjaFetch(callback);
                    } else {
                        callback(error);
                    }
                }
            });
            
        },
        function(callback){
            var samuraiFetch = arguments.callee;
            var req = https.get("https://samurai.ctr.shop.nintendo.net/samurai/ws/" + input.language + "/title/" + input.eshop_id + "/?shop_id=2", (res) => {
                samuraiAttempts++;
                var data = '';
                res.on('data', (d) => {
                    data += d;
                });
                
                res.on('end', () => {
                    var parser = new xml2js.Parser();
                    parser.parseString(data, (err, result) => {
                        if(err || result == null){
                            if(samuraiAttempts < 6){
                                samuraiFetch(callback);
                            } else {
                                callback(err);
                            }
                            
                        } else {
                            var titleInfo = firstOrNone(result.eshop.title)
                            
                            if(titleInfo == null){
                                callback();
                                return;
                            }
                            
                            info.eshop_id = input.eshop_id;
                            info.product_code = firstOrNone(titleInfo.product_code);
                            info.name = firstOrNone(titleInfo.name);
                            if(info.name)
                              info.name = info.name.replace(/(\n|<br[\/ ]*\>)/ig, " ").replace(/\s+/g, " ");
                              
                            info.platform = parseInt(titleInfo.platform[0]["$"].id);
                            //info.platform_name = firstOrNone(titleInfo.platform[0].name);
                            info.platform_device = titleInfo.platform[0]["$"].device;
                            
                            if(deviceTypes.indexOf(info.platform_device) == -1)
                                deviceTypes.push(info.platform_device);
                            
                            info.publisher = parseInt(titleInfo.publisher[0]["$"].id);
                            //info.publisher_name = firstOrNone(titleInfo.publisher[0].name);
                            info.banner_url = firstOrNone(titleInfo.banner_url);
                            info.icon_url = firstOrNone(titleInfo.icon_url);
                            info.data_size = firstOrNone(titleInfo.data_size);
                            info.description = (() => {
                                var desc = firstOrNone(titleInfo.description);
                                if(desc != null){
                                    return desc.replace(/\n/g, " ").replace(/\<br[\/ ]*\>/gi, "\n").replace(/\s+/g, " ");
                                }
                                    
                                if(desc == null)
                                    console.error("No Description: " + input.eshop_id);
                                
                                return desc;
                            })();
                            info.availability = {
                                eshop: firstOrNone(titleInfo.eshop_sales) == "true",
                                retail: firstOrNone(titleInfo.retail_sales) == "true",
                                dates: {
                                    eshop: firstOrNone(titleInfo.release_date_on_eshop),
                                    retail: firstOrNone(titleInfo.release_date_on_retail)
                                }
                            };
                            info.screenshots = [];
                            if(firstOrNone(titleInfo.screenshots)){
                                console.log(input.language + " > " + info.eshop_id + " > Screenshots");
                                for(var x = 0; x < titleInfo.screenshots[0].screenshot.length; x++){
                                    var screenshot;
                                    var screenshotNodes = titleInfo.screenshots[0].screenshot[x];
                                    
                                    if(screenshotNodes.image_url.length > 1){
                                        screenshot = {};
                                        for(var y = 0; y < screenshotNodes.image_url.length; y++){
                                            screenshot[screenshotNodes.image_url[y]["$"].type] = screenshotNodes.image_url[y]["_"];
                                        }
                                    } else {
                                        screenshot = screenshotNodes.image_url[0]["_"];
                                    }
                                    info.screenshots.push(screenshot);
                                }
                            }
                            info.movies = [];
                            if(firstOrNone(titleInfo.movies)){
                                console.log(input.language + " > " + info.eshop_id + " > Movies");
                                for(var x = 0; x < titleInfo.movies[0].movie.length; x++){
                                    
                                    var movieNodes = titleInfo.movies[0].movie[x];
                                    var movie = {
                                      banner_url: firstOrNone(movieNodes.banner_url),
                                      name: firstOrNone(movieNodes.name),
                                      files: []
                                    };
                                    
                                    if(movie.name)
                                      movie.name = movie.name.replace(/(\n|<br[\/ ]*\>)/ig, " ").replace(/\s+/g, " ");
                                    
                                    for(var y = 0; y < movieNodes.files[0].file.length; y++){
                                      var file = movieNodes.files[0].file[y];
                                      movie.files.push({
                                        quality: file["$"].quality,
                                        format: firstOrNone(file.format),
                                        movie_url: firstOrNone(file.movie_url),
                                        width: firstOrNone(file.width),
                                        height: firstOrNone(file.height),
                                        dimension: firstOrNone(file.dimension),
                                        play_time_sec: firstOrNone(file.play_time_sec)
                                      })
                                    }
                                    info.movies.push(movie);
                                }
                            }
                            
                            callback();
                        }
                    })
                });
            }).on('error', (err) => {
                if(samuraiAttempts < 6){
                    samuraiFetch(callback);
                } else {
                    callback(err);
                }
            });
			req.shouldKeepAlive = false;
			req.end();
        }
    ], () => {
        if(info.title_id != null){
            if(titleIDs[info.title_id] == null){
                if(Object.keys(eShopUIDs).indexOf(info.title_id) == -1){
                    eShopUIDs[info.title_id] = info.eshop_id; 
                }
                titleIDs[info.title_id] = {
                    title_id: info.title_id,
                    product_code: info.product_code,
                    platform_device: info.platform_device,
                    eshop_id: info.eshop_id,
                    languages: []
                }
            }
            if(titleIDs[info.title_id].languages.indexOf(input.language) == -1){
                titleIDs[info.title_id].languages.push(input.language)
            }
            
            
            if(titleData[info.title_id] == null){
                titleData[info.title_id] = {};
            }
            
            titleData[info.title_id][input.language] = info;
        }
        
        callback();
    })
}, 60);
samuraiTitleQueue.pause();

process.on('exit', function(){
    fs.writeFileSync(cwd + "/publishers.json", JSON.stringify(publishers, null, '\t'));
    fs.writeFileSync(cwd + "/platforms.json", JSON.stringify(platforms, null, '\t'));
    fs.writeFileSync(cwd + "/titles.json", JSON.stringify(titleIDs, null, '\t'));
    fs.writeFileSync(cwd + "/complete.json", JSON.stringify(titleData, null, '\t'));
    fs.writeFileSync(cwd + "/eshopuid.json", JSON.stringify(eShopUIDs, null, '\t'));
    
    var primaryLanguages = ["HK", "GB", "JP", "KR", "US"]
    
    var titleIDList = Object.keys(titleIDs);
    for(var x = 0; x < titleIDList; x++){
        fs.writeFileSync(cwd + "/titles/" + titleIDList[x].toLowerCase() + ".json", JSON.stringify(titleData[titleIDList[x]], null, '\t'));
    }
    
    var gameTitles = {}
    var primaries = {};
    var primariesForDevices = {};
    
    if(!fs.existsSync(cwd + "/titles"))
        fs.mkdirSync(cwd + "/titles");
        
    
    for(var x = 0; x < languages.length; x++){
        var output = {};
        for(var y = 0; y < titleIDList.length; y++){
                
            if(titleIDs[titleIDList[y]].languages.indexOf(languages[x]) != -1){
                
                var filename = cwd + "/titles/" + titleIDList[y].toLowerCase() + "-" + languages[x].toLowerCase() + ".json";
                var info = titleData[titleIDList[y]][languages[x]];
                if(fs.existsSync(filename)){
                    var oldInfoData = fs.readFileSync(filename),
                        oldInfo = JSON.parse(oldInfoData);
                        
                    extend(oldInfo, info);
                    info = oldInfo;
                }
                
                var infoJSON = JSON.stringify(info, null, '\t');
                
                if(infoJSON != oldInfoData)
                    fs.writeFileSync(filename, infoJSON);
                
                output[titleIDList[y]] = titleData[titleIDList[y]][languages[x]];
                
                if(gameTitles[titleIDList[y]] == undefined)
                    gameTitles[titleIDList[y]] = {};
                
                gameTitles[titleIDList[y]][languages[x]] = titleData[titleIDList[y]][languages[x]].name;
                
                if(primaryLanguages.indexOf(languages[x]) != -1){
                    if(primaries[languages[x]] == undefined)
                        primaries[languages[x]] = {};
                        
                    if(primariesForDevices[output[titleIDList[y]].platform_device] == undefined)
                        primariesForDevices[output[titleIDList[y]].platform_device] = {};
                        
                    if(primariesForDevices[output[titleIDList[y]].platform_device][languages[x]] == undefined)
                        primariesForDevices[output[titleIDList[y]].platform_device][languages[x]] = {};
                        
                    primaries[languages[x]][titleIDList[y]] = output[titleIDList[y]];
                    primariesForDevices[output[titleIDList[y]].platform_device][languages[x]][titleIDList[y]] = output[titleIDList[y]];
                }
            }
            
        }
        if(Object.keys(output).length > 0)
            fs.writeFileSync(cwd + "/complete-" + languages[x].toLowerCase() + ".json", JSON.stringify(output, null, '\t'));
        
        var outputKeys = Object.keys(output);
        
        for(var y = 0; y < deviceTypes.length; y++){
            var output2 = {};
            for(var z = 0; z < outputKeys.length; z++){
                var key = outputKeys[z];
                if(output[key].platform_device == deviceTypes[y]){
                    output2[key] = output[key];
                }
            }
            if(Object.keys(output2).length > 0)
                fs.writeFileSync(cwd + "/complete-" + deviceTypes[y].toLowerCase() + "-" + languages[x].toLowerCase() + ".json", JSON.stringify(output2, null, '\t'));
        }
    }
    
    fs.writeFileSync(cwd + "/title-names.json", JSON.stringify(gameTitles, null, '\t'))
    
    for(var x = 0; x < titleIDList.length; x++){
        var titleID = titleIDList[x];
        fs.writeFileSync(cwd + "/titles/" + titleID.toLowerCase() + ".json", JSON.stringify(titleData[titleID], null, '\t'));
    }
    
    fs.writeFileSync(cwd + "/complete-regionprimaries.json", JSON.stringify(primaries, null, '\t'))
    
    for(var x = 0; x < deviceTypes.length; x++){
        var output = {};
            
        for(var y = 0; y < titleIDList.length; y++){
            var id = titleIDList[y];
            console.log(titleIDs[id].platform_device + " - " + deviceTypes[x]);
            if(titleIDs[id].platform_device == deviceTypes[x]){
                output[id] = titleData[id];
            }
        }
        
        fs.writeFileSync(cwd + "/complete-" + deviceTypes[x].toLowerCase() + "-regionprimaries.json", JSON.stringify(primariesForDevices[deviceTypes[x]], null, '\t'));
        
        console.log("/complete-" + deviceTypes[x].toLowerCase() + ".json");
        fs.writeFileSync(cwd + "/complete-" + deviceTypes[x].toLowerCase() + ".json", JSON.stringify(output, null, '\t'));
    }
    
    console.log("Done!");
});
