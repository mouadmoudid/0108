// app/api/admin/products/overview/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
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

    // Get all products for this laundry
    const products = await prisma.product.findMany({
      where: { laundryId },
      include: {
        orderItems: {
          include: {
            order: {
              select: {
                finalAmount: true,
                createdAt: true,
                status: true
              }
            }
          }
        }
      }
    })

    // Calculate total products
    const totalProducts = products.length

    // Calculate revenue from products
    const totalRevenue = products.reduce((sum, product) => {
      return sum + product.orderItems.reduce((productSum, item) => {
        // Only count completed/delivered orders
        if (['COMPLETED', 'DELIVERED'].includes(item.order.status)) {
          return productSum + item.totalPrice
        }
        return productSum
      }, 0)
    }, 0)

    // Get product categories
    const categories = Array.from (new Set(products.map(product => product.category).filter(Boolean)))
    const categoryBreakdown = categories.map(category => {
      const categoryProducts = products.filter(product => product.category === category)
      const categoryRevenue = categoryProducts.reduce((sum, product) => {
        return sum + product.orderItems.reduce((productSum, item) => {
          if (['COMPLETED', 'DELIVERED'].includes(item.order.status)) {
            return productSum + item.totalPrice
          }
          return productSum
        }, 0)
      }, 0)

      return {
        category,
        productCount: categoryProducts.length,
        revenue: categoryRevenue,
        percentage: totalRevenue > 0 ? (categoryRevenue / totalRevenue) * 100 : 0
      }
    }).sort((a, b) => b.revenue - a.revenue)

    // Top performing products
    const productsWithStats = products.map(product => {
      const orderItems = product.orderItems.filter(item => 
        ['COMPLETED', 'DELIVERED'].includes(item.order.status)
      )
      
      const totalQuantitySold = orderItems.reduce((sum, item) => sum + item.quantity, 0)
      const totalRevenue = orderItems.reduce((sum, item) => sum + item.totalPrice, 0)
      const totalOrders = new Set(orderItems.map(item => item.orderId)).size

      return {
        id: product.id,
        name: product.name,
        category: product.category,
        price: product.price,
        stats: {
          quantitySold: totalQuantitySold,
          revenue: totalRevenue,
          orders: totalOrders,
          averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0
        }
      }
    }).sort((a, b) => b.stats.revenue - a.stats.revenue)

    const topProducts = productsWithStats.slice(0, 10)

    // Calculate monthly revenue trend (last 6 months)
    const monthlyRevenue = []
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date()
      monthStart.setMonth(monthStart.getMonth() - i)
      monthStart.setDate(1)
      monthStart.setHours(0, 0, 0, 0)
      
      const monthEnd = new Date(monthStart)
      monthEnd.setMonth(monthEnd.getMonth() + 1)
      monthEnd.setDate(0)
      monthEnd.setHours(23, 59, 59, 999)
      
      const monthRevenue = products.reduce((sum, product) => {
        return sum + product.orderItems.reduce((productSum, item) => {
          if (['COMPLETED', 'DELIVERED'].includes(item.order.status) &&
              item.order.createdAt >= monthStart && 
              item.order.createdAt <= monthEnd) {
            return productSum + item.totalPrice
          }
          return productSum
        }, 0)
      }, 0)
      
      monthlyRevenue.push({
        month: monthStart.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        revenue: monthRevenue
      })
    }

    // Product performance insights
    const averageProductPrice = products.length > 0 ? 
      products.reduce((sum, product) => sum + product.price, 0) / products.length : 0
    
    const mostPopularCategory = categoryBreakdown[0]?.category || 'No categories'
    
    const totalQuantitySold = products.reduce((sum, product) => {
      return sum + product.orderItems.reduce((productSum, item) => {
        if (['COMPLETED', 'DELIVERED'].includes(item.order.status)) {
          return productSum + item.quantity
        }
        return productSum
      }, 0)
    }, 0)

    const response = {
      // Key metrics
      metrics: {
        totalProducts,
        totalRevenue,
        totalQuantitySold,
        averageProductPrice
      },
      
      // Category analysis
      categories: {
        breakdown: categoryBreakdown,
        mostPopular: mostPopularCategory,
        totalCategories: categories.length
      },
      
      // Top performing products
      topProducts,
      
      // Revenue trends
      trends: {
        monthlyRevenue,
        revenueGrowth: monthlyRevenue.length >= 2 ? 
          monthlyRevenue[monthlyRevenue.length - 1].revenue - monthlyRevenue[monthlyRevenue.length - 2].revenue : 0
      },
      
      // Insights
      insights: {
        averageRevenuePerProduct: totalProducts > 0 ? totalRevenue / totalProducts : 0,
        averageQuantityPerProduct: totalProducts > 0 ? totalQuantitySold / totalProducts : 0,
        conversionRate: products.length > 0 ? 
          (products.filter(p => p.orderItems.length > 0).length / products.length) * 100 : 0
      }
    }

    return successResponse(response, 'Products overview retrieved successfully')
  } catch (error) {
    console.error('Products overview error:', error)
    return errorResponse('Failed to retrieve products overview', 500)
  }
}