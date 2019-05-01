var request = require('request');
const Discord = require('discord.js');
const RichEmbed = require('discord.js').RichEmbed;
const client = new Discord.Client();
const auths = require("B:\\AUTHS\\croustibot.json");

const port = process.env.PORT || 7532;

const io = require('socket.io')(port);
log("Sockets on port " + port);

var firebase = require('firebase-admin');

firebase.initializeApp({
  credential: firebase.credential.cert(require("B:\\BLAST\\firebase.json")),
  databaseURL: "https://iridium-blast.firebaseio.com"
});

var db = firebase.database();

client.on('ready', () => {
    
    console.log("CROUSTIBOT READY !")
    // const requests_channel = client.guilds.get("485017643070390285").channels.get("568603408609705995");
    const requests_channel = client.guilds.get("554684322301476868").channels.get("569828631527030786");

    var config = {};
    var auth_tokens = {};
    var dispos = {};
    var scrims = {};
    var planning = [];
    var maps = []

    db.ref("croustibot/config")     .on("value", snapshot => config = snapshot.val())
    db.ref("croustibot/auth_tokens").on("value", snapshot => auth_tokens = snapshot.val() || {})
    db.ref("croustibot/dispos")     .on("value", snapshot =>{dispos = snapshot.val();updateCalendar();})
    db.ref("croustibot/scrims")     .on("value", snapshot =>{scrims = snapshot.val();updateCalendar();})
    db.ref("croustibot/config/maps").on("value", snapshot =>{maps = snapshot.val(); io.emit("maps", maps);});

    function updateCalendar(){

        var today = Date.now();

        var processDay = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1);
        processDay.setTime(processDay.getTime()+((1-processDay.getDay())*86400000))
        
        planning = [];
        while (planning.length != 42){

            planning.push({
                time: processDay.getTime(),
                date: processDay.getDate(),
                month: processDay.getMonth(),
                outofmonth: (processDay.getMonth() != new Date(today).getMonth()),
                impossible: (processDay.getTime() < today-86400000),
                today: (processDay.getDate() == new Date(today).getDate() && processDay.getMonth() == new Date(today).getMonth()),
                prefer: (dispos[processDay.ENCODE()] == "true"),
                event: ((scrims) ? scrims[processDay.ENCODE_DT()] : false)
            });
            processDay.setTime(processDay.getTime()+(86400000))
        }
        io.emit("planning", planning);
    }

    var requests_users_ip = {};

    io.on("connection", function(socket){
        var ip = socket.handshake.address;

        socket.on("admin_panel_login", function(session, callback){        
            if (session.password){

                if (session.password == config.panel_admin_password){
                    var auth = random(50);
    
                    db.ref("croustibot/auth_tokens/" + auth).set({
                        ip,
                        date: Date.now(),
                        expire: Date.now() + (7*86400000)
                    });
                    callback({result:true, auth});
                    pannel_admin(auth)
                }else{
                    callback({result:false, message: "Wrong password"});
                }
                
            }else{
                if (auth_tokens[session.auth] && Date.now() < auth_tokens[session.auth].expire){
                    callback({result:true, auth: session.auth});
                    pannel_admin(session.auth)
                }else{
                    callback({result: false});
                }
            }
            
        })

        function pannel_admin(auth){

            db.ref("croustibot/requests/").on("value", snapshot => socket.emit("admin_update_requests", snapshot.val()));
            db.ref("croustibot/scrims/")  .on("value", snapshot => socket.emit("admin_update_scrims", snapshot.val()));
            db.ref("croustibot/config/twitch_channels").on("value", snapshot => socket.emit("admin_update_streams", (snapshot.val()) ? snapshot.val().filter(v=>v) : []));
            db.ref("croustibot/config/maxRequestPerIP").on("value", snapshot => socket.emit("admin_update_maxRequestPerIP", snapshot.val()));

            socket.on("admin_edit_maxRequestPerIP", newval => db.ref("croustibot/config/maxRequestPerIP").set(newval))

            socket.on("admin_edit_managerDiscordAUTH", function(newauth, callback){
                getDiscordUser(newauth, function(rs){
                    if (rs && rs.username){
                        db.ref("croustibot/config/managerDiscordAUTH").set(newauth)
                        callback({error: false, message: "Auth token updated ! Welcome " + rs.username + " !"});
                    }else{
                        callback({error: true, message: "The token is not valid"});
                    }
                })
            })

            socket.on("admin_addFriend", function(username, callback){
                db.ref("croustibot/config/managerDiscordAUTH").once("value", function(snapshot){
                    var token = snapshot.val();
                    if (token && token.length>20){
                        addFriend(username, function(exists, joinable){
                            if (exists && joinable){
                                getRelation(username, function(relation){
                                    getDM(relation, function(DM){
                                        if (DM != false){
                                            callback({result: true, DM})
                                        }else{
                                            callback({result: false})
                                        }
                                    }, token)
                                }, token)
                            }else{
                                callback({result: false})
                            }
                        }, token)
                    }else{
                        callback({result: false})
                    }
                })
            })

            socket.on("admin_accept_request", function(requests_id){
                db.ref("croustibot/requests/" + requests_id).once("value", function(snapshot){
                    var scrim = snapshot.val();
                    if (scrim && scrim.date){
                        db.ref("croustibot/scrims/" + scrim.date.replace(/\//g, '-')).set(scrim);
                        db.ref("croustibot/requests/" + requests_id).remove();
                    }
                })
            })
            socket.on("admin_ignore_request", requests_id => db.ref("croustibot/requests/" + requests_id).remove())
            socket.on("admin_delete_scrim", scrim_date => db.ref("croustibot/scrims/" + scrim_date).remove())

            socket.on("admin_update_scrim", function(date, scrim){
                db.ref("croustibot/scrims/" + date).set(scrim)
            })

            socket.on("admin_add_map", (type, name) => db.ref("croustibot/config/maps/" + type).push(name))
            socket.on("admin_remove_map", (type, UID) => db.ref("croustibot/config/maps/" + type + "/" + UID).remove())

            socket.on("admin_edit_dispos", (date, dispo=true) => db.ref("croustibot/dispos/" + new Date(date).ENCODE()).set(dispo.toString()))
            socket.on("admin_edit_streams", (newlist) => { db.ref("croustibot/config/twitch_channels").set(newlist); getStreams(); });
        }


        socket.emit("planning", planning);
        socket.emit("maps", maps);
        getStreams();

        socket.on("newScrimRequest", function(scrim, callback){
            if (!requests_users_ip[ip]) requests_users_ip[ip] = 0;

            if (requests_users_ip[ip] > config.maxRequestPerIP){

                callback('{"success": false, "message": "Too much requests from this IP"}');

            }else if (scrim.discordID && scrim.team_name && scrim.date){

                userExists(scrim.discordID, function(rs){

                    if (rs){
                        requests_users_ip[ip]++;

                        callback('{"success": true, "message": "We will contact you soon on Discord"}')
        
                        requests_channel.send("@here Nouvelle demande de scrim")

                        db.ref("croustibot/requests").push({
                            user: scrim.discordID,
                            team: scrim.team_name,
                            date: scrim.date,
                            time: (scrim.time || "--"),

                            maps: {
                                control: (scrim.map_control || "--"),
                                hybrid: (scrim.map_hybrid  || "--"),
                                assault: (scrim.map_assault || "--"),
                                escort: (scrim.map_escort  || "--"),
                            },
                        });

        
                        newEmbedDesc({
                            "Pseudo:  ": scrim.discordID,
                            "Équipe:     ": scrim.team_name,
                            "\n":"",
                            "Jour:     ": scrim.date,
                            "Heure:   ": (scrim.time || "--"),
                            "":"",
                            "Control map:  ": getMap(scrim.map_control, "control"),
                            "Hybrid map:   ": getMap(scrim.map_hybrid, "hybrid"),
                            "Assault map:  ": getMap(scrim.map_assault, "assault"),
                            "Escort map:    ": getMap(scrim.map_escort, "escort"),
                        }, function(desc){
                            requests_channel.send(new Discord.RichEmbed()
                                .setColor("DARK_GREEN")
                                .setDescription(desc+"\n[Gérer les demandes](http://semicroustillants.usp-3.fr/admin/)"));
                        })
        
                        // getDM(req.body.discordID, function(channelID){
                        //     sendMessage(channelID, `**Your scrim request has been sent**\`\`\`Pseudo: ${req.body.discordID}\nTeam: ${req.body.team_name}\n\nDay:   ${req.body.date}\nHour:  ${req.body.time||"--"}\n\nControl map: ${req.body.map_control||"--"}\nHybrid map:  ${req.body.map_hybrid||"--"}\nAssault map: ${req.body.map_assault||"--"}\nEscort map:  ${req.body.map_escort||"--"}\`\`\`_Do not reply to this message_`);
                        // });
        
                    }else{
                        callback('{"success": false, "resetUser": true, "message": "User '+scrim.discordID+' not found"}')
                    }
                    
                })
            }else{
                callback('{"success": false, "message": "Please fill all the required fields"}')
            }
        })
    })

    client.on('error', error => {
        console.error({
            message: "CLIENT ERROR",
            error,
        })
    });

    function getStreams(){
        db.ref("croustibot/config/twitch_channels").once("value", function(snapshot){
            var channels = snapshot.val() || [];
            var streaming = false;
            channels.forEach(function(channel_name){
                
                request.get('https://api.twitch.tv/kraken/streams/'+ channel_name +'?client_id=ozn5oq3ydzudzd5l8wzuh4vteqdyne', function(error, response, body) {
                    if (!streaming){
                        try{
                            var channel = JSON.parse(body);
                            if (channel["stream"] != null) { 
                                streaming = true;
                                client.user.setPresence({
                                    game: {
                                        name: "Semi-Croustillants (" + channel_name + ')',
                                        type: "STREAMING",
                                        url: "https://www.twitch.tv/"+channel_name
                                    }
                                });
                                io.emit("stream_change", channel_name);
                            }
                        }catch(e){
                            console.error({
                                message: "CAN'T PARSE TWITCH API RESPONSE",
                                // code: response.statusCode,
                                // error, body
                            })
                        }
                    }
                }); 
            });
        });
    }
    setInterval(getStreams, 30000);
    setInterval(updateCalendar, 30000);
    getStreams();

    const getMap = (mapUID, type) => ((mapUID && mapUID.length > 4) ? maps[type][mapUID] : "--");

});

client.on('message', msg => {
    if (msg.content == "!help"){
        var embed = new Discord.RichEmbed()
        .setTitle("Liste des commandes :")
        .setAuthor("THIRD BOT", "https://third.usp-3.fr/logo/2.png", "https://third.usp-3.fr/")
        .setFooter("BOT Développé par THIRD")
        .setColor("DARK_GREEN")
        
        .addBlankField(true)

        .addField("!stats {**BATTLETAG**}", "Donne les stats d'un joueur")
        .addField("!sondage {**QUESTION**}", "Crée un sondage")

        // .addBlankField(true)
        
        // .addField("!pv **@player1** [**@player2**]", "Crée un salon vocal privé, temporaire et injoignable par ceux qui ne sont pas mentionnés")
        
        .addBlankField(true)
        
        msg.channel.send(embed);
    }else if (msg.content.startsWith('!machine')){
        var os = require("os");

        const embed = new RichEmbed()
            .setTitle(os.hostname)
            .setColor(0xFF0000)

        embed.addField("Hostname", os.hostname);
        
        var cpus = [];
        os.cpus().forEach(cpu => {
            cpus.push(cpu.model);
        });

        embed.addField("CPUs", cpus.length + "x " + cpus[0]);
        embed.addField("Uptime", Math.round(os.uptime() / 3600) + " hours");
        
        msg.channel.send(embed);

    }else if (msg.content.startsWith('!stats ')) {

        msg.content = msg.content.replace('!stats ', "");
        
        log("Asking stats of " + msg.content);
        msg.channel.send("Chargement des stats de " + msg.content).then(function(loadingmsg){
            request("https://ow-api.com/v1/stats/pc/eu/"+msg.content+"/profile", function(error, response, body) {
                loadingmsg.delete();
                
                try{
                    var stats = JSON.parse(body);
    
                    msg.channel.send(new RichEmbed()
                        .setAuthor(stats.name, stats.icon)
                        .setThumbnail(stats.ratingIcon)
                        .setColor(0xFF0000)

                        .addField(
                        '**Rating :** ' + stats.rating,
                        '**Winrate :** ' + stats.competitiveStats.games.won + '/' + stats.competitiveStats.games.played + ' (' + Math.round(stats.competitiveStats.games.won/stats.competitiveStats.games.played*100) + "%)"
                        )
                    );
    
                }catch(e){
                    msg.channel.send("Désolé, je ne peux pas trouver ce joueur... :confused:")
                    log(e);
                }
            })
        });

    }else if (msg.content.startsWith('!sondage ')) {

        var texte = msg.content.replace('!sondage ', "");

        var choix = texte.split(" ");
        var title = choix.shift().replace(/_/g, " ");

        const reaction = (msg.guild.emojis.array().length >= 1) ? msg.guild.emojis.array() : ['☄','💥','🔥','⚡','💨','🌝','🌍','☀','💪','❄','🤛'];
        
        if (choix.length <= reaction.length){
            log("Nouveau sondage : " + title);
        
            const embed = new RichEmbed().setTitle(title).setColor(0xffff00);
    
            choix.forEach((val, i) => {
                embed.addField(reaction[i], val.replace(/_/g, " "), true)
            });
    
            msg.channel.send(embed).then(embed_message => {
                var i = 0;
                next();

                function next(){
                    embed_message.react(reaction[i]).then(()=>{
                        if (i < choix.length) next();
                        i++;
                    });
                }
            });
            
        }else{
            msg.channel.send("Trop d'arguments ! Maximum = " + reaction.length);
        }
        msg.delete();
    }else if (msg.content.startsWith('!dispos')) {

        day = new Date(Date.now());
        while (day.getDay() != 1){
            day.setTime(day.getTime()-86400000);
        }

        var jours = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"]
        var days = [];

        days.push(jours[day.getDay()] + " " + addZeros(day.getDate()) + "/" + addZeros(day.getMonth()));
        day.setTime(day.getTime()+86400000);
        while (day.getDay() != 1){
            days.push(jours[day.getDay()] + " " + addZeros(day.getDate()) + "/" + addZeros(day.getMonth()));
            day.setTime(day.getTime()+86400000);
        }

        console.log(days);


        msg.channel.send("__**@here Quelles sont vos disponibilités ?**__\n")

        var i = 0;
        next();

        function next(){
            const embed = new RichEmbed().setTitle(days[i]).setColor(0xffff00);

            msg.channel.send(embed).then(embed_message => {
                i++;
                if (i < days.length) setTimeout(next, 1000);
            });
        }
            
        msg.delete();
    }

});

function log(log) { console.log("[Croustibot]: " + log); }

client.login(auths.croustibot);

function newEmbedDesc(params, callback){
    var desc = "";

    var i = 1;
    var total = Object.keys(params).length;
    
    Object.keys(params).forEach(function(key){
        if (key != "" && params[key] != ""){
            desc = desc + `\n${key} **${params[key]}**`
        }else desc = desc + "\n";
        
        if (i == total){
            callback(desc);
        }else i++;
    });

}

function userExists(discordID, callback){
    addFriend(discordID, function(userExists){
        if (userExists){
            callback(true);
            getRelation(discordID, removeFriend);
        }else{
            callback(false);
        }
    })
}

function addFriend(username, callback, token=""){
    request.post({
        headers: {
            'authorization': token || auths.userbot,
            'Content-Type': 'application/json'
        },
        uri: 'https://discordapp.com/api/v6/users/@me/relationships',
        body: JSON.stringify({
            username: username.split("#")[0],
            discriminator: username.split("#")[1]
        }),
        method: 'POST'
    }, function(error, response, body) {
        var code = 0;
        try{
            code = JSON.parse(body).code;
            if (code == 80004){ // L'utilisateur n'existe pas
                callback(false, false);
            }else if (code == 80001){ // L'utilisateur à bloqué le bot / utilisateur
                callback(true, false);
            }else{
                callback(true, true);
            }
        }catch(ex){
            callback(true, true)
        }
    })
}

function removeFriend(relationID){
    request.delete({
        method: 'DELETE',
        uri: 'https://discordapp.com/api/v6/users/@me/relationships/' + relationID,
        headers: {
            'authorization': auths.userbot,
            'Content-Type': 'application/json'
        }
    })
}

// function sendMessage(channelID, message, callback=()=>{}){
//     request.post({
//         uri: 'https://discordapp.com/api/v6/channels/'+channelID+'/messages',
//         method: 'POST',
//         headers: {
//             'authorization': auths.userbot,
//             'Content-Type': 'application/json'
//         },
//         body: JSON.stringify({content:message})
//     }, function(error, response, body) {
//         try{
//             callback(JSON.parse(body))
//         }catch(ex){
//             callback(false)
//         }
//     })
// }

function getRelation(username, callback, token=""){
    request.get({
        uri: 'https://discordapp.com/api/v6/users/@me/relationships',
        method: 'GET',
        headers: {
            'authorization': token || auths.userbot,
            'Content-Type': 'application/json'
        }
    }, function(error, response, body) {
        let relation = JSON.parse(body).filter(v=> v.user.username==username.split("#")[0] && v.user.discriminator==username.split("#")[1])[0];
        if (relation && relation.id){
            callback(relation.id);
        }else callback(false);
    })
}

function getDM(relation, callback, token=""){
    request.post({
        uri: 'https://discordapp.com/api/v6/users/@me/channels',
        method: 'POST',
        headers: {
            'authorization': token || auths.userbot,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({recipient_id: relation})
    }, function(error, response, body) {
        let dm = JSON.parse(body);
        if (dm && dm.id){
            callback(dm.id);
        }else callback(false);
    })
}

function getDiscordUser(token, callback){
    request.get({
        uri: 'https://discordapp.com/api/v6/users/@me',
        method: 'GET',
        headers: {
            'authorization': token,
            'Content-Type': 'application/json'
        }
    }, function(error, response, body) {
        callback(JSON.parse(body))
    })
}

Date.prototype.ENCODE = function(){return this.getFullYear() + '-' + addZeros(this.getMonth()+1) + '-' + addZeros(this.getDate())}
Date.prototype.ENCODE_DT = function(){return addZeros(this.getDate()) + '-' + addZeros(this.getMonth()+1) + '-' + this.getFullYear()}
var addZeros = nbr => (nbr<10)?"0"+nbr:nbr;
var randomNb = (len) => Math.floor(Math.random()*Math.pow(10,len));
function random(len) {var a = "";var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";for (var i = 0; i < len; i++) a += c.charAt(Math.floor(Math.random() * c.length));return a;}