// 美国职场情景句子。每行格式：英文|中文|小贴士(可选)
window.SCENES_RAW = [
  {
    id: "survival",
    title: "救命句：听不懂时",
    icon: "🆘",
    lines: `
Sorry, could you say that again?|抱歉，你能再说一遍吗？|最常用的一句，一定要熟练。
Could you speak a little slower, please?|你能说慢一点吗？|
Sorry, I don't understand.|抱歉，我没听懂。|
What does that mean?|那是什么意思？|
How do you spell that?|那个怎么拼？|听不清名字、邮箱时很有用。
Could you write it down for me?|你能帮我写下来吗？|
Do you mean ...?|你的意思是……吗？|后面接你理解的内容，用来确认。
Let me make sure I understand.|让我确认一下我理解得对不对。|
How do you say this in English?|这个用英语怎么说？|
English is not my first language, so please bear with me.|英语不是我的母语，请多包涵。|美国同事通常很理解，直接说出来没关系。
`,
  },
  {
    id: "intro",
    title: "自我介绍和寒暄",
    icon: "👋",
    lines: `
Hi, I'm Aoi. Nice to meet you.|你好，我是 Aoi，很高兴认识你。|把名字换成你自己的。
Nice to meet you too.|我也很高兴认识你。|
I'm new here. I just started this week.|我是新来的，这周刚入职。|
I'm from China.|我来自中国。|
I work in the sales department.|我在销售部工作。|
How's it going?|最近怎么样？|美国人很常用的打招呼方式。
Pretty good, thanks. How about you?|挺好的，谢谢。你呢？|
How was your weekend?|你周末过得怎么样？|周一最常听到的问题。
It was great. I just relaxed at home.|很好，我就在家休息了。|
See you tomorrow!|明天见！|
`,
  },
  {
    id: "interview",
    title: "面试",
    icon: "💼",
    lines: `
Thank you for having me.|谢谢您给我这次机会。|面试开始时说。
Let me tell you a little about myself.|我简单介绍一下自己。|
I have five years of experience in this field.|我在这个领域有五年经验。|把数字换成你的情况。
I'm good at solving problems.|我擅长解决问题。|
I'm a hard worker and I learn fast.|我工作努力，学得也快。|
I'm interested in this position because I want to grow.|我对这个职位感兴趣，因为我想成长。|
My English is still improving, but I can communicate well at work.|我的英语还在进步中，但工作上能正常沟通。|
When would I start?|我什么时候可以开始上班？|
Do you have any questions for me?|你有什么问题要问我吗？|这是面试官会问的，要听得懂。
Yes, what does a typical day look like in this role?|有的，这个岗位一天的工作通常是怎样的？|准备一个问题回答上面那句。
`,
  },
  {
    id: "meeting",
    title: "开会",
    icon: "🗓️",
    lines: `
Can you hear me okay?|你能听清我说话吗？|线上会议开头常用。
Sorry, you're on mute.|抱歉，你开着静音。|
Can you share your screen?|你能共享一下屏幕吗？|
I have a quick question.|我有个小问题。|想插话提问时用。
I agree with that.|我同意。|
I see your point, but I have a different idea.|我明白你的意思，但我有个不同的想法。|礼貌地表达不同意见。
Let me check and get back to you.|我查一下再回复你。|不确定时的万能回答。
What are the next steps?|下一步做什么？|
Who is going to do this?|这件事由谁来做？|
Thanks, everyone. That's all for today.|谢谢大家，今天就到这里。|
`,
  },
  {
    id: "email",
    title: "写邮件和发消息",
    icon: "✉️",
    lines: `
Hi John,|嗨 John，|美国职场邮件开头一般就用 Hi + 名字。
I hope you're doing well.|希望你一切都好。|
I'm writing to ask about the schedule.|我写信是想问一下日程安排。|
Please see the attached file.|请查看附件。|
Could you please send me the report by Friday?|你能在周五前把报告发给我吗？|
Thanks for your quick reply.|谢谢你的快速回复。|
Sorry for the late reply.|抱歉回复晚了。|
Just following up on my last email.|跟进一下我上一封邮件。|对方没回复时用。
Let me know if you have any questions.|如有任何问题请告诉我。|邮件结尾最常用。
Best regards,|此致敬礼（祝好），|署名前一行。也可以用 Best, 或 Thanks,
`,
  },
  {
    id: "help",
    title: "求助和请假",
    icon: "🙋",
    lines: `
Do you have a minute?|你有空吗？（能占用你一分钟吗？）|找人帮忙前先这样问。
Could you help me with this?|你能帮我看一下这个吗？|
I'm not sure how to do this.|我不太确定这个该怎么做。|
Can you show me how?|你能演示给我看吗？|
Thanks, that really helps.|谢谢，这真的很有帮助。|
I'm not feeling well today.|我今天身体不太舒服。|
I need to take a day off tomorrow.|我明天需要请一天假。|
I have a doctor's appointment this afternoon.|我今天下午约了医生。|
I'm running a little late.|我会晚到一会儿。|堵车迟到时发消息用。
I'll be there in ten minutes.|我十分钟后到。|
`,
  },
  {
    id: "smalltalk",
    title: "和同事闲聊",
    icon: "☕",
    lines: `
Do you want to grab lunch?|想一起去吃午饭吗？|
What do you usually do on weekends?|你周末一般做什么？|
I like hiking and cooking.|我喜欢徒步和做饭。|换成你自己的爱好。
The weather is really nice today.|今天天气真好。|天气是最安全的闲聊话题。
Any plans for the weekend?|周末有什么计划吗？|周五常听到。
Not much. Just relaxing.|没什么，就是休息一下。|
That sounds fun!|听起来很有趣！|
Good for you!|真为你高兴！|
Have a good one!|祝你愉快！|下班道别时美国人常说。
Take care.|保重。|道别用语。
`,
  },
  {
    id: "life",
    title: "生活必备",
    icon: "🏠",
    lines: `
I'd like to open a bank account.|我想开个银行账户。|
Can I pay by card?|我可以刷卡吗？|
Can I get a receipt, please?|可以给我收据吗？|
I'd like a coffee, please.|我想要一杯咖啡。|点单时用 I'd like ...
For here or to go?|在这里吃还是带走？|店员会问你，要听得懂。
To go, please.|带走，谢谢。|
I'm looking for an apartment.|我在找公寓。|
How much is the rent?|房租多少？|
I need to see a doctor.|我需要看医生。|
Where is the nearest bus stop?|最近的公交车站在哪里？|
`,
  },
];
