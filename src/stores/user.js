import { defineStore } from 'pinia'

export const useUserStore = defineStore('user', {
  state: () => ({
    userInfo: {}
  }),
  actions: {
    setUserInfo(info) {
      this.userInfo = info
    },
    clearUserInfo() {
      this.userInfo = {}
    }
  }
}) 