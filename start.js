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
    client.user.setActivity("semicroustillants.usp-3.fr", "WATCHING");
    
    console.log("CROUSTIBOT READY !")
    // const requests_channel = client.guilds.get("485017643070390285").channels.get("568603408609705995");
    const requests_channel = client.guilds.get("554684322301476868").channels.get("569828631527030786");

    var auth_tokens = {};
    var dispos = {};
    var planning = [];

    updateCalendar();
    function updateCalendar(){

        var today = Date.now();

        var processDay = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1);
        processDay.setTime(processDay.getTime()+((1-processDay.getDay())*86400000))
        
        while (planning.length != 42){
            planning.push({
                time: processDay.getTime(),
                date: processDay.getDate(),
                month: processDay.getMonth(),
                outofmonth: (processDay.getMonth() != new Date(today).getMonth()),
                impossible: (processDay.getTime() < today-86400000),
                today: (processDay.getDate() == new Date(today).getDate() && processDay.getMonth() == new Date(today).getMonth()),
                prefer: (dispos[processDay.ENCODE()] >= 6),
            });
            processDay.setTime(processDay.getTime()+(86400000))
        }
        io.emit("planning", planning);
    }

    db.ref("croustibot/auth_tokens").on("value", function(snapshot){
        auth_tokens = snapshot.val()
    })

    db.ref("croustibot/dispos").on("value", function(snapshot){
        dispos = snapshot.val()
    })

    var requests = {};
    var maxRequestPerIP = 2;

    io.on("connection", function(socket){
        var ip = socket.handshake.address;

        socket.on("admin_panel_login", function(username, auth, callback){
            if (auth_tokens[username +'@'+ auth] && Date.now() < auth_tokens[username +'@'+ auth]){
                callback({auth, username});
                admin(username, auth)
            }else{
                var code = randomNb(4)
                var auth = random(50);
                
                socket.emit("admin_waiting_token", code);

                listen();

                function listen(){
                    client.once('message', msg => {
                        if (socket.disconnected) return;
                        if (msg.channel == requests_channel && msg.content == code){
                            var username = msg.author.username.replace(/\//g, "-");
                            db.ref("croustibot/auth_tokens/" + username +'@'+ auth).set(Date.now() + (7*86400000));
                            callback({auth, username});
                            admin(username, auth)
                            msg.delete();
                        }else listen()
                    });
                }
            }
        })

        function admin(username, auth){

            db.ref("croustibot/requests/").on("value", function(snapshot){
                socket.emit("admin_update_requests", snapshot.val());
            })

            socket.on("admin_accept_request", function(request_id){
                db.ref("croustibot/requests/" + request_id).once("value", function(snapshot){
                    var scrim = snapshot.val();
                    db.ref("croustibot/scrims/" + scrim.date.replace(/\//g, '-') + ' ' + scrim.time).set(scrim);
                    db.ref("croustibot/requests/" + request_id).remove();
                })
            })

            socket.on("setDispo", function(date, dispo){
                if (dispo){
                    var newDispos = dispo[date] || [];
                    if (!newDispos.includes(username)) newDispos.push(username);
                    db.ref("croustibot/dispos/" + date).set(newDispos);
                }else{
                    var newDispos = (dispo[date] || []).filter(v=> v!=username);
                    db.ref("croustibot/dispos/" + date).set(newDispos);
                }
            })

        }


        socket.emit("planning", planning);

        socket.on("newScrimRequest", function(scrim, callback){
            if (!requests[ip]) requests[ip] = 0;

            if (requests[ip] > maxRequestPerIP){

                callback('{"success": false, "message": "Too much requests from this IP"}');

            }else if (scrim.discordID && scrim.team_name && scrim.date){

                userExists(scrim.discordID, function(rs){

                    if (rs){
                        requests[ip]++;

                        callback('{"success": true, "message": "We will contact you soon on Discord"}')
        
                        requests_channel.send("@here Nouvelle demande de scrim")

                        db.ref("croustibot/requests/").push({
                            user: scrim.discordID,
                            team: scrim.team_name,
                            date: scrim.date,
                            time: scrim.time,

                            maps: {
                                control: scrim.map_control,
                                hybrid: scrim.map_hybrid,
                                assault: scrim.map_assault,
                                escort: scrim.map_escort,
                            },
                        });
        
                        newEmbedDesc({
                            "Pseudo:  ": scrim.discordID,
                            "Équipe:     ": scrim.team_name,
                            "\n":"",
                            "Jour:     ": scrim.date,
                            "Heure:   ": (scrim.time || "--"),
                            "":"",
                            "Control map:  ": (scrim.map_control || "--"),
                            "Hybrid map:   ": (scrim.map_hybrid  || "--"),
                            "Assault map:  ": (scrim.map_assault || "--"),
                            "Escort map:    ": (scrim.map_escort  || "--"),
                        }, function(desc){
                            requests_channel.send(new Discord.RichEmbed()
                                .setColor("DARK_GREEN")
                                .setTitle(desc)
                                .setDescription("[Gérer les demandes](http://semicroustillants.usp-3.fr/admin/)"));
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
        const reaction = ['☄','💥','🔥','⚡','💨','🌝','🌍','☀','💪','❄','🤛'];
        
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

function addFriend(username, callback){
    request.post({
        headers: {
            'authorization': auths.userbot,
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
            }else if (code == 80001){ // L'utilisateur à bloqué le bot
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

function getRelation(username, callback){
    request.get({
        uri: 'https://discordapp.com/api/v6/users/@me/relationships',
        method: 'GET',
        headers: {
            'authorization': auths.userbot,
            'Content-Type': 'application/json'
        }
    }, function(error, response, body) {
        let user = JSON.parse(body).filter(v=> v.user.username==username.split("#")[0] && v.user.discriminator==username.split("#")[1])[0];
        if (user && user.id){
            callback(user.id);
        }else callback(false);
    })
}

// function getDM(username, callback){
//     request.get({
//         uri: 'https://discordapp.com/api/v6/users/@me/channels',
//         method: 'GET',
//         headers: {
//             'authorization': auths.userbot,
//             'Content-Type': 'application/json'
//         }
//     }, function(error, response, body) {
//         let user = JSON.parse(body).filter(v=> v.recipients[0].username==username.split("#")[0] && v.recipients[0].discriminator==username.split("#")[1])[0];
//         if (user && user.id){
//             callback(user.id);
//         }else callback(false);
//     })
// }

Date.prototype.ENCODE = function(){return addZeros(this.getFullYear()) + '-' + addZeros(this.getMonth()+1) + '-' + addZeros(this.getDate())}
var addZeros = nbr => (nbr<10)?"0"+nbr:nbr;
var randomNb = (len) => Math.floor(Math.random()*Math.pow(10,len));
function random(len) {var a = "";var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";for (var i = 0; i < len; i++) a += c.charAt(Math.floor(Math.random() * c.length));return a;}