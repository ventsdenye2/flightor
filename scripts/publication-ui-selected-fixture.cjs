// Synthetic UI-only final text for this entry's original IDs and slots. Not model output or historical evidence.
const activities = [
 ['guide_5801e3c926542a1babe5f7c0', '浅草寺与仲见世商店街', 'Sensoji Temple and Nakamise Street', '下午游览浅草寺，再沿仲见世商店街散步。', 'Visit Sensoji Temple in the afternoon, then stroll along Nakamise Street.', '文化景点与街区步行相结合，适合你希望的轻松节奏。', 'This combines a cultural landmark with a relaxed neighborhood walk.'],
 ['guide_aeced67a0e463e42e3b925b7', '藏前街区', 'Kuramae neighborhood', '晚上在藏前街区散步，观察沿街的传统工艺店与新店。', 'Walk through Kuramae in the evening and explore its streets of traditional craft shops and newer stores.', '延续浅草周边的文化体验，不必额外安排跨城行程。', 'Continue exploring the area around Asakusa without adding another city to the day.'],
 ['guide_07795c91d1a9fe6e2cae1b29', '上野公园文化区', 'Ueno Park cultural area', '上午在上野公园文化区散步，感受博物馆周边的文化氛围。', 'Spend the morning walking through the cultural area of Ueno Park and around its museums.', '回应你对文化的兴趣，同时保留散步和休息的空间。', 'This responds to your interest in culture while leaving room for walking and rest.'],
 ['guide_f2ca4520bdfe7640538c67f6', '原宿竹下通', 'Takeshita Street', '下午漫步原宿竹下通，浏览街头服饰店并寻找小吃。', 'Stroll along Takeshita Street in Harajuku in the afternoon, browsing fashion shops and looking for snacks.', '将街区观察与小吃偏好结合，作为轻松的下午安排。', 'Combine neighborhood exploration with your interest in snacks for a relaxed afternoon.']
]
exports.selectedText = locale => ({ locale, reply: locale === 'zh' ? '这份两日安排保留已选航班，结合文化街区与小吃体验。' : 'This two-day itinerary keeps your selected flight and combines cultural areas with food stops.',
 overview: locale === 'zh' ? '首日下午游览浅草，晚上散步藏前；第二天上午前往上野公园，下午逛原宿竹下通。' : 'Explore Asakusa on the first afternoon and Kuramae in the evening. Visit Ueno Park the next morning, followed by Takeshita Street in the afternoon.',
 days: [{day:1,theme:locale==='zh'?'浅草与藏前漫步':'Asakusa and Kuramae walks'},{day:2,theme:locale==='zh'?'上野文化与原宿小吃':'Ueno culture and Harajuku snacks'}],
 activities: activities.map(a=>({activityId:a[0],name:a[locale==='zh'?1:2],introduction:a[locale==='zh'?3:4],recommendationReason:a[locale==='zh'?5:6]})) })
