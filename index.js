// Initial setup
if (process.argv.length != 3) console.log("usage: node index.js <token>");
process.env.NTBA_FIX_319 = 1;
const axios = require("axios"),
  fs = require("fs"),
  TelegramBot = require("node-telegram-bot-api"),
  actions = require("./json/actions.json"),
  groups = fs.existsSync("./json/groups.json")
    ? require("./json/groups.json")
    : {},
  memes = require("./json/memes.json"),
  settings = require("./json/settings.json"),
  bot = new TelegramBot(process.argv[2], { polling: true });
let botName;

// String formatting via placeholders: has troubles with placeholders injections
String.format = function() {
  let s = arguments[0].slice();
  for (let i = 0; i < arguments.length - 1; ++i)
    s = s.replace(new RegExp("\\{" + i + "\\}", "gm"), arguments[i + 1]);
  return s;
};

// Returns a new Date object for tomorrow's Date
function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

// Simple messages
function message(msg, text) {
  bot
    .sendMessage(msg.chat.id, text, settings.messageOptions)
    .catch((e) => console.error(e.stack));
}

// Web scraping the timetable -- Lezioni oggi
function timetable(msg, url, date, title, fallbackText) {
  axios
    .get(url)
    .then((res) => {
      let lectures = [];
      for (let i = 0; i < res.data.length; ++i) {
        let start = new Date(res.data[i].start);
        if (
          start.getFullYear() === date.getFullYear() &&
          start.getMonth() === date.getMonth() &&
          start.getDate() === date.getDate()
        )
          lectures.push(res.data[i]);
      }
      let text = title;
      lectures.sort((a, b) => a.start - b.start);
      for (let i = 0; i < lectures.length; ++i)
        text += `  🕘 <b><a href="${lectures[i].teams}">${lectures[i].title}</a></b> ${lectures[i].time}
  🏢 ${lectures[i].aule[0].des_edificio} - ${lectures[i].aule[0].des_piano}
  📍 ${lectures[i].aule[0].des_indirizzo}
  〰〰〰〰〰〰〰〰〰〰〰
`;
      if (lectures.length !== 0) message(msg, text);
      else message(msg, fallbackText);
    })
    .catch((e) => console.error(e.stack));
}

// Autogenerated courses info
function course(msg, name, virtuale, teams, website, professors) {
  const emails = professors.join("@unibo.it\n  ") + "@unibo.it";
  /* convert a string into kebab case
   * useful for GitHub repository
   *
   * example:
   * string = "Logica per l'informatica"
   * converted_string = toOurCase(string); = "logica-per-informatica" (sic!)
   */
  const toOurCase = (str) =>
    str &&
    str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(
        /(?:[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+)'?/g
      )
      .filter((value) => !value.endsWith("'"))
      .map((x) => x.toLowerCase())
      .join("-");
  message(
    msg,
    `<b>${name}</b>
  <a href='https://virtuale.unibo.it/course/view.php?id=${virtuale}'>Virtuale</a>
  <a href='https://teams.microsoft.com/l/meetup-join/19%3ameeting_${teams}%40thread.v2/0?context=%7b%22Tid%22%3a%22e99647dc-1b08-454a-bf8c-699181b389ab%22%2c%22Oid%22%3a%22080683d2-51aa-4842-aa73-291a43203f71%22%7d'>Videolezione</a>
  <a href='https://www.unibo.it/it/didattica/insegnamenti/insegnamento/${website}'>Sito</a>
  <a href='https://www.unibo.it/it/didattica/insegnamenti/insegnamento/${website}/orariolezioni'>Orario</a>
  ${emails}
  <a href='https://csunibo.github.io/${toOurCase(
      name
    )}/'>📚 Risorse: materiali, libri, prove</a>
  <a href='https://github.com/csunibo/${toOurCase(
      name
    )}/'>📂 Repository GitHub delle risorse</a>`
  );
}

// Adding a user to a list
function lookingFor(msg, singularText, pluralText, chatError) {
  if (
    (msg.chat.type !== "group" && msg.chat.type !== "supergroup") ||
    settings.lookingForBlackList.includes(msg.chat.id)
  )
    message(msg, chatError);
  else {
    const chatId = msg.chat.id,
      senderId = msg.from.id;
    if (!(chatId in groups)) groups[chatId] = [];
    const group = groups[chatId];
    if (!group.includes(senderId)) group.push(senderId);
    fs.writeFileSync("json/groups.json", JSON.stringify(groups));
    const length = group.length.toString(),
      promises = Array(length);
    group.forEach((e, i) => {
      promises[i] = bot
        .getChatMember(chatId, e.toString())
        .then(
          (result) => {
            const user = result.user;
            return `👤 <a href='tg://user?id=${user.id}'>${user.first_name}${user.last_name ? " " + user.last_name : ""
              }</a>\n`;
          },
          (reason) => console.error(reason)
        )
        .catch((error) => console.error(error));
    });
    Promise.allSettled(promises).then((result) => {
      let list = String.format(
        length == "1" ? singularText : pluralText,
        msg.chat.title,
        length
      );
      result.forEach((e, i) => {
        list +=
          e.status === "fulfilled" && e.value
            ? e.value
            : `👤 <a href='tg://user?id=${group[i]}'>??? ???</a>\n`;
      });
      message(msg, list);
    });
  }
}

// Removing a user from a list
function notLookingFor(msg, text, chatError, notFoundError) {
  if (
    (msg.chat.type !== "group" && msg.chat.type !== "supergroup") ||
    settings.lookingForBlackList.includes(msg.chat.id)
  )
    message(msg, chatError);
  else {
    const chatId = msg.chat.id,
      title = msg.chat.title;
    if (!(chatId in groups)) message(msg, String.format(notFoundError, title));
    else {
      const group = groups[chatId],
        senderId = msg.from.id;
      if (!group.includes(senderId))
        message(msg, String.format(notFoundError, title));
      else {
        group.splice(group.indexOf(senderId), 1);
        if (group.length == 0) delete groups[chatId];
        fs.writeFileSync("json/groups.json", JSON.stringify(groups));
        message(msg, String.format(text, title));
      }
    }
  }
}

// Send help message
function giveHelp(msg) {
  answer = "";
  for (command in actions)
    if (actions[command] && actions[command].description)
      answer += `/${command} - ${actions[command].description}\n`;
  message(msg, answer);
}

// Available actions
function act(msg, action) {
  switch (action.type) {
    case "alias":
      act(msg, actions[action.command]);
      break;
    case "course":
      course(
        msg,
        action.name,
        action.virtuale,
        action.teams,
        action.website,
        action.professors
      );
      break;
    case "help":
      giveHelp(msg);
      break;
    case "lookingFor":
      lookingFor(msg, action.singularText, action.pluralText, action.chatError);
      break;
    case "message":
      message(msg, action.text);
      break;
    case "notLookingFor":
      notLookingFor(msg, action.text, action.chatError, action.notFoundError);
      break;
    case "todayLectures":
      timetable(msg, action.url, new Date(), action.title, action.fallbackText);
      break;
    case "tomorrowLectures":
      timetable(
        msg,
        action.url,
        tomorrowDate(),
        action.title,
        action.fallbackText
      );
      break;
    default:
      console.error(`Unknown action type "${action.type}"`);
  }
}

// Parsing
function onMessage(msg) {
  if (!msg.text) return; // no text
  const text = msg.text.toString();
  if (text[0] !== "/") return; // no command
  // '/command@bot param0 ... paramN' -> 'command@bot'
  let command = text.split(" ")[0].substring(1);
  const indexOfAt = command.indexOf("@");
  if (indexOfAt != -1) {
    if (command.substring(indexOfAt + 1) !== botName) {
      return; // command issued to another bot
    }
    // 'command@bot' -> 'command'
    command = command.substring(0, command.indexOf("@"));
  }
  if (command in actions)
    // action
    act(msg, actions[command]);
  else if (command in memes)
    // meme
    message(msg, memes[command]);
  // unkown command
  else act(msg, actions["unknown"]);
}

function init(botUser) {
  botName = botUser.username;
  bot.on("message", onMessage);
  bot.on("error", console.error);
}

bot.getMe().then(init).catch(console.error);
