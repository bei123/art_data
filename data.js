// 数据艺术原作数据
const originalArtworks = [
    {
        image: "https://example.com/art1.jpg",
        title: "星空",
        artist: {
            avatar: "https://example.com/artist1.jpg",
            name: "张大千",
            description: "中国著名画家，擅长山水画"
        }
    },
    {
        image: "https://example.com/art2.jpg",
        title: "向日葵",
        artist: {
            avatar: "https://example.com/artist2.jpg",
            name: "梵高",
            description: "荷兰后印象派画家"
        }
    }
];

// 数字艺术数据
const digitalArtworks = [
    {
        image_url: "https://example.com/digital1.jpg",
        title: "数字宇宙",
        author: "李小明",
        description: "探索数字世界的无限可能",
        contract_address: "0x1234567890abcdef",
        token_id: "1",
        blockchain: "Ethereum",
        blockchain_url: "https://etherscan.io/token/1"
    },
    {
        image_url: "https://example.com/digital2.jpg",
        title: "未来城市",
        author: "王小红",
        description: "未来智慧城市的数字艺术呈现",
        contract_address: "0x0987654321fedcba",
        token_id: "2",
        blockchain: "Ethereum",
        blockchain_url: "https://etherscan.io/token/2"
    }
];

// 实物行权分类数据
const physicalCategories = [
    {
        image: "https://example.com/category1.jpg",
        icon: "https://example.com/icon1.png",
        title: "油画",
        count: 50,
        description: "传统油画作品"
    },
    {
        image: "https://example.com/category2.jpg",
        icon: "https://example.com/icon2.png",
        title: "雕塑",
        count: 30,
        description: "现代雕塑作品"
    }
];

module.exports = {
    originalArtworks,
    digitalArtworks,
    physicalCategories
}; 