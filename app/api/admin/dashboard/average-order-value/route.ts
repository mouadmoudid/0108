// app/api/admin/dashboard/average-order-value/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const timeframe = searchParams.get('timeframe') || 'year'
    const laundryId = searchParams.get('laundryId')

    if (!laundryId) {
      return errorResponse('laundryId parameter is required', 400)
    }

    // Verify laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    // Calculate date range based on timeframe
    const now = new Date()
    let startDate: Date
    let periodsToShow: number
    let periodLength: number // days
    
    switch (timeframe) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        periodsToShow = 7
        periodLength = 1
        break
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        periodsToShow = 4
        periodLength = 7
        break
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        periodsToShow = 12
        periodLength = 30
        break
      default:
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
        periodsToShow = 12
        periodLength = 30
    }

    // Get orders for the timeframe
    const ordersInPeriod = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: startDate
        }
      },
      include: {
        orderItems: {
          include: {
            product: true
          }
        }
      }
    })

    // Calculate current period AOV
    const totalOrders = ordersInPeriod.length
    const totalRevenue = ordersInPeriod.reduce((sum, order) => sum + order.finalAmount, 0)
    const currentAOV = totalOrders > 0 ? totalRevenue / totalOrders : 0

    // Get previous period for comparison
    const previousPeriodStart = new Date(startDate.getTime() - (now.getTime() - startDate.getTime()))
    const previousPeriodOrders = await prisma.order.findMany({
      where: {
        laundryId,
        createdAt: {
          gte: previousPeriodStart,
          lt: startDate
        }
      }
    })

    const previousRevenue = previousPeriodOrders.reduce((sum, order) => sum + order.finalAmount, 0)
    const previousAOV = previousPeriodOrders.length > 0 ? previousRevenue / previousPeriodOrders.length : 0
    const aovGrowth = previousAOV > 0 ? ((currentAOV - previousAOV) / previousAOV) * 100 : 0

    // Generate AOV trend data
    const aovTrendData = []
    
    for (let i = periodsToShow - 1; i >= 0; i--) {
      const periodStart = new Date(now.getTime() - (i + 1) * periodLength * 24 * 60 * 60 * 1000)
      const periodEnd = new Date(now.getTime() - i * periodLength * 24 * 60 * 60 * 1000)
      
      const periodOrders = ordersInPeriod.filter(order => 
        order.createdAt >= periodStart && order.createdAt <= periodEnd
      )
      
      const periodRevenue = periodOrders.reduce((sum, order) => sum + order.finalAmount, 0)
      const periodAOV = periodOrders.length > 0 ? periodRevenue / periodOrders.length : 0
      
      let periodLabel: string
      if (timeframe === 'year') {
        periodLabel = periodStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      } else if (timeframe === 'month') {
        periodLabel = `Week ${periodsToShow - i}`
      } else {
        periodLabel = periodStart.toLocaleDateString('en-US', { weekday: 'short' })
      }
      
      aovTrendData.push({
        period: periodLabel,
        aov: periodAOV,
        orders: periodOrders.length,
        revenue: periodRevenue
      })
    }

    // Calculate AOV by service category
    interface CategoryData {
      totalRevenue: number;
      totalOrders: Set<string>;
      orders: number;
    }
    const aovByCategory: Record<string, CategoryData> = {}
    ordersInPeriod.forEach(order => {
      order.orderItems.forEach(item => {
        const category = item.product.category || 'Other'
        if (!aovByCategory[category]) {
          aovByCategory[category] = {
            totalRevenue: 0,
            totalOrders: new Set(),
            orders: 0
          }
        }
        aovByCategory[category].totalRevenue += item.totalPrice
        aovByCategory[category].totalOrders.add(order.id)
      })
    })

    const categoryAOVData = Object.entries(aovByCategory).map(([category, data]: [string, any]) => ({
      category,
      aov: data.totalOrders.size > 0 ? data.totalRevenue / data.totalOrders.size : 0,
      orders: data.totalOrders.size,
      revenue: data.totalRevenue
    })).sort((a, b) => b.aov - a.aov)

    // Calculate AOV by customer segments (based on order frequency)
    const customerOrderCounts: Record<string, { orders: any[], totalSpent: number }> = {}
    ordersInPeriod.forEach(order => {
      if (!customerOrderCounts[order.customerId]) {
        customerOrderCounts[order.customerId] = {
          orders: [],
          totalSpent: 0
        }
      }
      customerOrderCounts[order.customerId].orders.push(order)
      customerOrderCounts[order.customerId].totalSpent += order.finalAmount
    })

    const segments: Record<string, { orders: any[], revenue: number }> = {
      'New Customers': { orders: [], revenue: 0 },
      'Regular Customers': { orders: [], revenue: 0 },
      'VIP Customers': { orders: [], revenue: 0 }
    }

    Object.values(customerOrderCounts).forEach((customer) => {
      const orderCount = customer.orders.length
      let segment: string
      
      if (orderCount === 1) {
        segment = 'New Customers'
      } else if (orderCount <= 5) {
        segment = 'Regular Customers'
      } else {
        segment = 'VIP Customers'
      }
      
      if (segments[segment]) {
        segments[segment].orders.push(...customer.orders)
        segments[segment].revenue += customer.totalSpent
      }
    })

    const segmentAOVData = Object.entries(segments).map(([segment, data]) => ({
      segment,
      aov: data.orders.length > 0 ? data.revenue / data.orders.length : 0,
      orders: data.orders.length,
      revenue: data.revenue
    }))

    const response = {
      // Current metrics
      current: {
        aov: currentAOV,
        totalOrders,
        totalRevenue,
        growth: aovGrowth
      },
      
      // Comparison with previous period
      comparison: {
        previousAOV,
        growthPercentage: aovGrowth,
        improvementAmount: currentAOV - previousAOV
      },
      
      // Trend analysis
      trends: aovTrendData,
      
      // Analysis by category
      byCategory: categoryAOVData,
      
      // Analysis by customer segment
      bySegment: segmentAOVData,
      
      // Period info
      period: {
        timeframe,
        startDate: startDate.toISOString(),
        endDate: now.toISOString()
      }
    }

    return successResponse(response, 'Average order value analysis retrieved successfully')
  } catch (error) {
    console.error('AOV analysis error:', error)
    return errorResponse('Failed to retrieve AOV analysis', 500)
  }
}