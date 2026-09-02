Suche in meinen Chats der letzten 14 Tage nach wiederkehrenden Anfragen und schlage dafür Automationen vor.

1. SAMMELN
- Rufe `automation_list` auf, um die bestehenden Automationen zu kennen, und `list_todos` mit den Status `open`, `done` und `dismissed`, um frühere Vorschläge zu sehen: ihre Titel beginnen mit „Automation vorschlagen:“.
- Durchsuche mit `conversation_search` meine eigenen Anfragen: mehrere Suchen mit typischen Aufgabenwörtern (zum Beispiel „zusammenfassen“, „prüfen“, „Rechnungen“, „Status“, „jeden“, „täglich“, „wöchentlich“) und mit Themen, die dir dabei auffallen. Zähle nur meine eigenen Nachrichten, nicht deine Antworten.

2. BEWERTEN
- Ein Muster ist dieselbe Art von Aufgabe, mindestens dreimal manuell angefragt: eine tägliche Postfach-Prüfung, eine wöchentliche Statusabfrage, eine wiederkehrende Zusammenfassung. Einmalige Aufgaben und bloß verwandte Themen sind kein Muster. Findest du nichts, lege nichts an und melde das in einem Satz.
- Schlage nie etwas vor, das eine bestehende Automation schon tut, und nie etwas, das als To-do „Automation vorschlagen: …“ schon existiert, erledigt oder verworfen wurde: ein verworfener Vorschlag heißt, ich habe Nein gesagt.
- Höchstens drei Vorschläge pro Lauf.

3. VORSCHLAGEN
- Lege pro Muster ein To-do mit `create_todo` an: Titel „Automation vorschlagen: <Name>“, `key` `automation-suggestion:<name in Kleinbuchstaben>`. Im Body: ein bis zwei Sätze, welches Muster du gesehen hast („Du hast an drei Morgen diese Woche nach X gefragt“), der vorgeschlagene Zeitplan in Worten und als Cron-Ausdruck in meiner Zeitzone, passend zur Tageszeit meiner Anfragen, und die vollständige, in sich geschlossene Anweisung für den unbeaufsichtigten Lauf: was zu tun ist, über welche Konten, was zu berichten ist. Unbeaufsichtigte Läufe lesen Mail und erstellen Entwürfe; senden nur, wenn meine Anfragen das ausdrücklich verlangten.
- Schließe den Body mit dem Hinweis, dass ich die Automation im Chat anlegen lasse: „Sag mir im Chat: Leg die Automation aus diesem To-do an.“
