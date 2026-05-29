<template>
  <div class="erp-page">
    <a-card class="content-card" :bordered="false">
      <PageSummaryStrip :items="summaryItems" />
      <template #title>采购单管理</template>

      <MobileFilterPanel>
        <template #filters>
          <a-select
            v-model:value="filterField"
            size="small"
            :options="filterFieldOptions"
            class="purchase-toolbar-control"
            :get-popup-container="getPopupContainer"
          />
          <a-select
            v-if="false && filterField === 'supplier'"
            v-model:value="supplierFilter"
            :options="supplierFilterOptions"
            allow-clear
            style="width: 220px"
            placeholder="选择供应商"
          />
          <div v-else class="purchase-toolbar-control purchase-toolbar-control--keyword">
            <a-input
              v-model:value="keywordInput"
              size="small"
              :placeholder="filterPlaceholder"
              allow-clear
              class="purchase-toolbar-keyword-input"
            />
          </div>
          <a-select
            v-model:value="supplierFilter"
            :options="supplierFilterOptions"
            allow-clear
            size="small"
            class="purchase-toolbar-control"
            :get-popup-container="getPopupContainer"
            placeholder="供应商"
          />
          <a-select
            v-model:value="materialCategoryFilter"
            :options="materialCategoryFilterOptions"
            allow-clear
            size="small"
            class="purchase-toolbar-control"
            :get-popup-container="getPopupContainer"
            placeholder="分类"
          />
          <a-select
            v-model:value="documentStatusFilter"
            :options="documentStatusOptions"
            allow-clear
            size="small"
            class="purchase-toolbar-control purchase-toolbar-control--narrow"
            :get-popup-container="getPopupContainer"
            placeholder="单据状态"
          />
          <a-select
            v-model:value="sortField"
            size="small"
            :options="sortFieldOptions"
            class="purchase-toolbar-control"
            :get-popup-container="getPopupContainer"
            placeholder="排序字段"
          />
          <a-select
            v-model:value="sortOrder"
            size="small"
            :options="sortOrderOptions"
            class="purchase-toolbar-control purchase-toolbar-control--narrow"
            :get-popup-container="getPopupContainer"
            placeholder="排序方向"
          />
          <a-date-picker
            v-model:value="dateRangeStart"
            size="small"
            value-format="YYYY-MM-DD"
            placeholder="开始日期"
            class="purchase-toolbar-control purchase-toolbar-control--date"
            :get-popup-container="getPopupContainer"
          />
          <a-date-picker
            v-model:value="dateRangeEnd"
            size="small"
            value-format="YYYY-MM-DD"
            placeholder="结束日期"
            class="purchase-toolbar-control purchase-toolbar-control--date"
            :get-popup-container="getPopupContainer"
          />
          <a-select
            v-model:value="batchDocumentStatus"
            size="small"
            :options="quickDocumentStatusOptions"
            class="purchase-toolbar-control"
            :get-popup-container="getPopupContainer"
            placeholder="改单据状态"
          />
          <a-button size="small" :disabled="!selectedRowKeys.length || !batchDocumentStatus" @click="applyBatchDocumentStatus">批量改单据状态</a-button>
          <a-button size="small" :disabled="!selectedRowKeys.length" @click="handleBatchAudit">批量审核</a-button>
          <a-button size="small" :disabled="selectedRowKeys.length < 2" @click="mergeSelectedPurchaseOrders">勾选合并</a-button>
          <a-button size="small" :disabled="!canBatchUnmerge" @click="unmergeSelectedPurchaseOrders">取消合并</a-button>
          <a-button size="small" :disabled="!selectedRowKeys.length" @click="returnSelectedToDraft()">批量退回草稿</a-button>
          <a-button size="small" danger :disabled="!selectedRowKeys.length" @click="voidSelected()">批量作废</a-button>
          <a-button size="small" danger :disabled="!selectedRowKeys.length" @click="handleBatchDelete">批量删除</a-button>
          <a-dropdown>
            <a-button size="small" :disabled="!selectedRowKeys.length">批量导出</a-button>
            <template #overlay>
              <a-menu @click="({ key }) => handleBatchExport(key)">
                <a-menu-item key="pdf">PDF</a-menu-item>
                <a-menu-item key="excel">Excel</a-menu-item>
                <a-menu-item key="image">图片</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </template>
        <template #actions>
          <ColumnConfigButton v-model="visibleColumnKeys" :columns="columnDefs" />
          <a-button class="toolbar-refresh-btn" :loading="listLoading" @click="loadList">刷新</a-button>
          <a-button type="primary" @click="openCreate">新增采购批次</a-button>
        </template>
      </MobileFilterPanel>

      <div class="erp-table-caption">
        同一供应商、同一采购单下的多条原料会归并成一张采购单显示；筛选条件会先精确收口，再在结果范围内检索。
      </div>
      <div v-if="activePurchaseFilterChips.length" class="smart-filter-bar">
        <span class="smart-filter-bar__label">当前筛选</span>
        <a-tag v-for="chip in activePurchaseFilterChips" :key="chip" color="blue">{{ chip }}</a-tag>
        <a-button size="small" @click="clearPurchaseFilters">清空筛选</a-button>
      </div>

      <div v-if="isMobileLayout" class="erp-mobile-list">
        <div
          v-for="record in filteredList"
          :key="record.id"
          class="erp-mobile-card"
          :class="{ 'erp-mobile-card--voided': record.document_status === 'voided' }"
        >
          <div class="erp-mobile-card__head">
            <div>
              <div class="erp-mobile-card__title">{{ record.purchase_order_no || record.batch_no }}</div>
              <div class="erp-mobile-card__meta">{{ record.supplier || '-' }} · {{ documentStatusLabel(record.document_status) }}</div>
            </div>
            <a-tag :color="record.document_status === 'approved' ? 'green' : (record.document_status === 'voided' ? 'default' : 'blue')">
              {{ priceTypeLabel(record.price_type) }}
            </a-tag>
          </div>
          <div class="erp-mobile-card__section">
            <div class="erp-mobile-card__label">原料信息</div>
            <div class="erp-mobile-card__value">
              {{ record.member_rows?.length > 1 ? `${record.member_rows.length} 项原料` : formatMaterialLabel(record) }}
            </div>
            <div class="erp-mobile-card__sub">
              颜色：{{ record.member_rows?.length > 1 ? '多项' : (record.color || '-') }} ·
              单据：{{ documentStatusLabel(record.document_status) }}
            </div>
          </div>
          <div class="erp-mobile-card__grid">
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">采购数量</div>
              <div class="erp-mobile-card__value">{{ formatQty(record.purchase_input_qty || record.gross_qty) }} {{ normalizeUnit(record.purchase_input_unit || record.price_unit || record.unit) }}</div>
            </div>
            <div class="erp-mobile-card__stat">
              <div class="erp-mobile-card__label">当前剩余</div>
              <div class="erp-mobile-card__value">{{ formatQty(record.remaining_qty) }} {{ normalizeUnit(record.unit) }}</div>
            </div>
          </div>
          <div class="erp-mobile-card__sub">
            录入单价：{{ formatMoney(record.price, 4) }} / {{ normalizeUnit(record.price_unit || record.unit) }}
            <span v-if="Number(record.base_unit_price || 0)"> · 成本：{{ formatMoney(record.base_unit_price, 4) }} / {{ normalizeUnit(record.unit) }}</span>
          </div>
          <div class="erp-mobile-card__sub">到货日期：{{ record.received_at || '-' }}</div>
          <div class="erp-mobile-card__footer">
            <a-button size="small" @click="openDetail(record)">详情</a-button>
            <a-button size="small" @click="openCopy(record)">复制</a-button>
            <a-button v-if="record.document_status !== 'approved'" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button v-if="canUnmergeRecord(record)" size="small" @click="unmergeSelectedPurchaseOrders(getRecordIds(record))">取消合并</a-button>
            <a-button size="small" type="primary" @click="openAuditModal(record)">审核</a-button>
            <a-button v-if="record.document_status === 'approved'" size="small" @click="openAfterSaleModal(record, 'return')">退回供应商</a-button>
            <a-button v-if="record.document_status === 'approved'" size="small" @click="openAfterSaleModal(record, 'exchange')">供应商换货</a-button>
          </div>
        </div>
      </div>

      <a-table
        v-else
        class="erp-dense-table"
        :data-source="pagedFilteredList"
        :columns="columns"
        :loading="listLoading"
        :row-key="(row) => row.id"
        :row-class-name="getPurchaseRowClassName"
        :pagination="purchasePagination"
        :scroll="{ x: 1680 }"
        size="small"
        :row-selection="rowSelection"
      >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'batch_no'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.purchase_order_no || record.batch_no }}</div>
            <div v-if="record.purchase_order_no" class="table-secondary">批次：{{ record.batch_no }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'material'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">
              {{ record.member_rows?.length > 1 ? `${record.member_rows.length} 项原料` : formatMaterialLabel(record) }}
            </div>
            <div v-if="record.member_rows?.length > 1" class="table-secondary">
              {{ record.member_rows.slice(0, 2).map((item) => formatMaterialLabel(item)).join('、') }}
              <span v-if="record.member_rows.length > 2"> 等</span>
            </div>
            <div v-else-if="record.size" class="table-secondary">尺码：{{ record.size }}</div>
            <div class="table-secondary">颜色：{{ record.member_rows?.length > 1 ? '多项' : (record.color || '-') }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'qty'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">
              {{ record.member_rows?.length > 1 ? `明细：${record.member_rows.length} 项` : `采购：${formatQty(record.purchase_input_qty || record.gross_qty)} ${normalizeUnit(record.purchase_input_unit || record.price_unit || record.unit)}` }}
            </div>
            <div v-if="Number(record.actual_input_qty || 0) > 0" class="table-secondary">实际数量：{{ formatQty(record.actual_input_qty) }} {{ normalizeUnit(record.actual_input_unit || record.purchase_input_unit || record.unit) }}</div>
            <div class="table-secondary">折合入库：{{ formatQty(record.gross_qty) }} {{ normalizeUnit(record.unit) }}</div>
            <div class="table-secondary">剩余：{{ formatQty(record.remaining_qty) }} {{ normalizeUnit(record.unit) }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'price'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ priceTypeLabel(record.price_type) }}</div>
            <div class="table-secondary">录入：{{ formatMoney(record.price, 4) }} / {{ normalizeUnit(record.price_unit || record.unit) }}</div>
            <div class="table-secondary">成本：{{ formatMoney(record.base_unit_price, 4) }} / {{ normalizeUnit(record.unit) }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'supplier'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.supplier || '-' }}</div>
            <div class="table-secondary">采购单：{{ record.purchase_order_no || record.batch_no || '-' }}</div>
            <div class="table-secondary">单据：{{ documentStatusLabel(record.document_status) }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'received_at'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.received_at || '-' }}</div>
            <div class="table-secondary">创建：{{ String(record.created_at || '').slice(0, 10) || '-' }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'remark'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.remark || '-' }}</div>
            <div v-if="record.member_rows?.length > 1" class="table-secondary">
              共 {{ record.member_rows.length }} 项明细
            </div>
          </div>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-select
              size="small"
              style="width: 100px"
              :value="record.document_status === 'approved' || record.document_status === 'voided' ? undefined : record.document_status"
              :options="quickDocumentStatusOptions"
              placeholder="改单据"
              @change="(value) => updateSingleDocumentStatus(record, value)"
            />
            <a-button size="small" type="primary" @click="openAuditModal(record)">审核</a-button>
            <a-button v-if="record.document_status === 'approved'" size="small" @click="openAfterSaleModal(record, 'return')">退回供应商</a-button>
            <a-button v-if="record.document_status === 'approved'" size="small" @click="openAfterSaleModal(record, 'exchange')">供应商换货</a-button>
            <a-button v-if="record.document_status !== 'draft'" size="small" @click="returnSelectedToDraft(getRecordIds(record))">退回草稿</a-button>
            <a-button size="small" danger @click="voidSelected(getRecordIds(record))">作废</a-button>
            <a-dropdown>
              <a-button size="small">导出</a-button>
              <template #overlay>
                <a-menu @click="({ key }) => handleExport(record, key)">
                  <a-menu-item key="pdf">PDF</a-menu-item>
                  <a-menu-item key="excel">Excel</a-menu-item>
                  <a-menu-item key="image">图片</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
            <a-button size="small" @click="openDetail(record)">详情</a-button>
            <a-button size="small" @click="openCopy(record)">复制</a-button>
            <a-button v-if="record.document_status !== 'approved'" size="small" @click="openEdit(record)">编辑</a-button>
            <a-button v-if="canUnmergeRecord(record)" size="small" @click="unmergeSelectedPurchaseOrders(getRecordIds(record))">取消合并</a-button>
            <a-button v-if="record.document_status !== 'approved' && (!record.member_rows || record.member_rows.length === 1)" size="small" @click="openSplit(record)">拆分</a-button>
            <a-popconfirm v-if="record.document_status !== 'approved'" title="确认删除该采购单？" @confirm="remove(record)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>
      <div v-if="!isMobileLayout" class="table-pagination table-pagination--with-size">
        <label class="table-pagination__size">
          <span>每页</span>
          <select v-model.number="purchasePageSize" class="table-pagination__native-select">
            <option v-for="size in purchasePageSizeOptions" :key="size" :value="size">{{ size }}</option>
          </select>
          <span>条</span>
        </label>
      </div>

    <a-modal v-model:open="visible" :title="viewMode ? '采购批次详情' : (isEditMode ? '编辑采购批次' : '新增采购批次')" width="1180px" @ok="save" :footer="viewMode ? null : undefined">
      <div :style="viewMode ? 'pointer-events:none; opacity:0.96;' : ''">
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="7"><a-form-item label="供应商"><InlineOptionSelect v-model="form.supplier" :entries="optionLists.suppliers" option-type="supplier" add-label="供应商" placeholder="选择供应商" allow-clear @options-updated="handleOptionsUpdated" /></a-form-item></a-col>
          <a-col :span="7"><a-form-item label="供应商采购单号"><a-input v-model:value="form.purchase_order_no" placeholder="同一张采购单下可录入多条原料" /></a-form-item></a-col>
          <a-col :span="4"><a-form-item label="单据状态"><a-select v-model:value="form.document_status" :options="documentStatusOptions" /></a-form-item></a-col>
          <a-col :span="6"><a-form-item label="到货日期"><a-date-picker v-model:value="dateValue" style="width: 100%" value-format="YYYY-MM-DD" /></a-form-item></a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="10">
            <a-form-item label="总金额四舍五入">
              <a-space direction="vertical" size="small" style="width: 100%;">
                <a-checkbox v-model:checked="form.rounding_enabled">启用整单四舍五入</a-checkbox>
                <div class="table-secondary">
                  当前录入金额：{{ formatMoney(getDocumentInputAmount(lines), 2) }}
                  <span v-if="form.rounding_enabled">
                    ，四舍五入调整：{{ formatSignedMoney(getDocumentRoundingAdjustment(lines), 2) }}
                    ，调整后：{{ formatMoney(getDocumentRoundedTotal(lines), 2) }}
                  </span>
                </div>
              </a-space>
            </a-form-item>
          </a-col>
        </a-row>

        <a-form-item label="备注">
          <a-textarea v-model:value="form.remark" :rows="2" :auto-size="{ minRows: 2, maxRows: 5 }" />
        </a-form-item>
      </a-form>

      <a-divider />

      <div class="section-caption" style="margin-bottom: 12px;">
        <div>
          <div class="section-caption__title">采购明细</div>
          <div class="section-caption__desc">同一供应商、同一采购单下可一次录入多条原料，库存数量会自动折算成原料基准单位。</div>
        </div>
        <a-button v-if="!viewMode" @click="addLine">新增原料</a-button>
      </div>

      <div v-for="(line, index) in lines" :key="line.localKey" class="bom-row">
        <div class="sortable-row__bar">
          <span class="sortable-row__title">明细 {{ index + 1 }}</span>
          <a-button v-if="!viewMode" size="small" danger @click="removeLine(index)">删除</a-button>
        </div>
        <a-row :gutter="10" class="plan-editor-row">
          <a-col :flex="'280px'"><a-form-item label="原料" required><a-select v-model:value="line.material_id" :options="materialOptions" show-search option-filter-prop="label" :get-popup-container="getPopupContainer" @change="() => handleMaterialOrColorChange(line)" /></a-form-item></a-col>
          <a-col :flex="'0 0 150px'"><a-form-item label="颜色"><a-select v-model:value="line.color" style="width: 100%" show-search option-filter-prop="label" allow-clear :options="getColorOptions(line.material_id)" :get-popup-container="getPopupContainer" placeholder="选择颜色" @change="() => handleMaterialOrColorChange(line)" /></a-form-item></a-col>
          <a-col :flex="'190px'"><a-form-item label="备注"><a-input v-model:value="line.color_remark" placeholder="该原料备注" /></a-form-item></a-col>
          <a-col v-if="isCupMaterial(line)" :flex="'0 0 128px'"><a-form-item label="尺码"><a-select v-model:value="line.size" style="width: 100%" show-search option-filter-prop="label" allow-clear :options="getSizeOptions(line.material_id, line.size)" :get-popup-container="getPopupContainer" placeholder="选择尺码" @change="() => handleSizeChange(line)" /></a-form-item></a-col>
          <a-col :flex="'126px'"><a-form-item label="采购数量"><a-input-number v-model:value="line.purchase_input_qty" style="width: 100%" :min="0" :step="0.0001" /></a-form-item></a-col>
          <a-col :flex="'76px'"><a-form-item label="采购单位"><a-select v-model:value="line.purchase_input_unit" :options="getPurchaseUnitOptions(line.material_id)" :get-popup-container="getPopupContainer" @change="() => handlePurchaseUnitChange(line)" /></a-form-item></a-col>
        </a-row>
        <a-row :gutter="10" class="plan-editor-row plan-editor-row--compact">
          <a-col class="plan-roll-count-col" :flex="'0 0 84px'"><a-form-item label="条数/卷数"><a-input-number v-model:value="line.roll_count" class="plan-roll-count-input" :min="0" :step="1" /></a-form-item></a-col>
          <a-col :flex="'0 0 184px'"><a-form-item label="单价类型"><a-select v-model:value="line.price_type" :options="priceTypeOptions" :get-popup-container="getPopupContainer" @change="() => handlePriceTypeChange(line)" /></a-form-item></a-col>
          <a-col :flex="'0 0 96px'"><a-form-item label="单价单位"><a-select v-model:value="line.price_unit" :options="getPurchaseUnitOptions(line.material_id)" :get-popup-container="getPopupContainer" @change="() => handlePriceUnitChange(line)" /></a-form-item></a-col>
          <a-col :flex="'0 0 144px'"><a-form-item label="单价"><a-input-number v-model:value="line.price" style="width: 100%" :min="0" :step="0.0001" @change="() => markPriceAsManual(line)" /></a-form-item></a-col>
          <a-col :flex="'92px'"><a-form-item label="加工费"><a-input-number v-model:value="line.processing_cost" style="width: 100%" :min="0" /></a-form-item></a-col>
          <a-col :flex="'160px'"><a-form-item label="加工说明"><a-input v-model:value="line.processing_note" /></a-form-item></a-col>
        </a-row>
        <div v-if="resolveLineMaterial(line)" class="bom-row-hint">
          <div>基准单位：{{ normalizeUnit(resolveLineMaterial(line).unit) }}</div>
          <div v-if="line.size">采购尺码：{{ line.size }}</div>
          <div>实际数量：{{ formatQty(getActualInputQty(line)) }} {{ normalizeUnit(getActualInputUnit(line)) }}</div>
          <div>折合库存数量：{{ formatQty(getConvertedBaseQty(line)) }} {{ normalizeUnit(resolveLineMaterial(line).unit) }}</div>
          <div>录入金额：{{ formatMoney(getLineInputAmount(line), 2) }}</div>
        </div>
      </div>
      <div
        class="bom-row"
        style="position: sticky; bottom: 0; z-index: 3; margin-top: 12px; background: #fff; border-color: #d8e7ff; box-shadow: 0 -8px 24px rgba(15, 40, 80, 0.06);"
      >
        <div class="sortable-row__bar">
          <span class="sortable-row__title">整单金额汇总</span>
        </div>
        <a-row :gutter="12">
          <a-col :span="8">
            <div class="table-stack table-stack--tight">
              <div class="table-secondary">原始采购金额</div>
              <div class="table-primary" style="font-size: 22px;">{{ formatMoney(getDocumentInputAmount(lines), 2) }}</div>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="table-stack table-stack--tight">
              <div class="table-secondary">四舍五入调整</div>
              <div class="table-primary" :style="{ fontSize: '22px', color: form.rounding_enabled ? '#1d4ed8' : '#94a3b8' }">
                {{ form.rounding_enabled ? formatSignedMoney(getDocumentRoundingAdjustment(lines), 2) : '未启用' }}
              </div>
            </div>
          </a-col>
          <a-col :span="8">
            <div class="table-stack table-stack--tight">
              <div class="table-secondary">最终采购总金额</div>
              <div class="table-primary" style="font-size: 24px; color: #0f172a;">{{ formatMoney(getDocumentRoundedTotal(lines), 2) }}</div>
            </div>
          </a-col>
        </a-row>
      </div>
      </div>
      <div v-if="viewMode" style="margin-top: 16px;">
        <a-divider />
        <div class="section-caption__title" style="margin-bottom: 8px;">单据图片</div>
        <div v-if="auditImages.length" class="multi-image-grid">
          <div v-for="(item, index) in auditImages" :key="`${index}-${item.slice(0, 20)}`" class="multi-image-grid__item">
            <a-popover placement="rightTop" trigger="hover" overlay-class-name="inventory-image-popover">
              <template #content>
                <img :src="item" class="inventory-image-preview inventory-image-preview--full" alt="单据图片预览" />
              </template>
              <img :src="item" class="multi-image-grid__preview" alt="单据图片" @click="openImagePreview(item)" />
            </a-popover>
          </div>
        </div>
        <div v-else class="table-secondary">暂无单据图片</div>
      </div>
      <template v-if="!viewMode" #footer>
        <a-space>
          <a-button @click="visible = false">取消</a-button>
          <a-button @click="saveTempDraft">保存为临时草稿</a-button>
          <a-button type="primary" @click="save">确定</a-button>
        </a-space>
      </template>
    </a-modal>

    <a-modal v-model:open="splitVisible" title="拆分采购批次" width="720px" @ok="saveSplit">
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="12"><a-form-item label="来源批次"><a-input :value="splitForm.source_batch_no" readonly /></a-form-item></a-col>
          <a-col :span="12"><a-form-item label="新批次号"><a-input v-model:value="splitForm.batch_no" /></a-form-item></a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="8"><a-form-item label="拆分数量"><a-input-number v-model:value="splitForm.split_qty" style="width: 100%" :min="0" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="新颜色"><a-input v-model:value="splitForm.color" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="加工费"><a-input-number v-model:value="splitForm.processing_cost" style="width: 100%" :min="0" /></a-form-item></a-col>
        </a-row>
        <a-form-item label="备注"><a-textarea v-model:value="splitForm.remark" :rows="2" /></a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:open="auditVisible" title="审核采购单" width="860px" @ok="confirmAudit">
      <a-form layout="vertical">
        <a-form-item label="审核单据图片" required>
          <MultiImageDropInput v-model="auditImages" title="上传采购单 / 收货单图片" />
        </a-form-item>
        <div v-if="auditLines.length" class="section-caption" style="margin: 8px 0 12px;">
          <div>
            <div class="section-caption__title">到货去向</div>
            <div class="section-caption__desc">审核时如不填写工厂去向，则默认全部入仓；后续也可以在出仓入仓页面按数量再出库到工厂。</div>
          </div>
        </div>
        <div v-for="line in auditLines" :key="line.id" class="bom-row" style="margin-bottom: 12px;">
          <div class="sortable-row__bar">
            <span class="sortable-row__title">{{ line.material_label }}<span v-if="line.color"> / {{ line.color }}</span><span v-if="line.size"> / {{ line.size }}</span></span>
            <a-button size="small" @click="addAuditAllocation(line)">新增去向</a-button>
          </div>
          <a-row :gutter="10" class="plan-editor-row" style="margin-bottom: 8px;">
            <a-col :span="6">
              <a-form-item label="实际数量">
                <a-input :value="`${formatQty(line.actual_input_qty)} ${normalizeUnit(line.actual_input_unit)}`" readonly />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="已分配到工厂">
                <a-input :value="`${formatQty(getAuditAllocatedQty(line))} ${normalizeUnit(line.actual_input_unit)}`" readonly />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="留仓数量">
                <a-input :value="`${formatQty(getAuditWarehouseQty(line))} ${normalizeUnit(line.actual_input_unit)}`" readonly />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="入仓仓库">
                <InlineOptionSelect
                  v-model="line.warehouse_name"
                  :entries="optionLists.warehouses"
                  option-type="warehouse"
                  add-label="仓库"
                  placeholder="选择仓库"
                  allow-clear
                  @options-updated="handleOptionsUpdated"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <div v-for="allocation in line.allocations" :key="allocation.localKey" class="bom-row" style="margin: 8px 0;">
            <a-row :gutter="10" class="plan-editor-row">
              <a-col :span="7">
                <a-form-item label="出库到工厂">
                  <InlineOptionSelect
                    v-model="allocation.factory_name"
                    :entries="optionLists.factories"
                    option-type="factory"
                    add-label="加工厂"
                    placeholder="选择工厂"
                    allow-clear
                    @options-updated="handleOptionsUpdated"
                  />
                </a-form-item>
              </a-col>
              <a-col :span="5">
                <a-form-item label="发往数量">
                  <a-input-number v-model:value="allocation.qty" style="width: 100%" :min="0" :step="0.0001" @change="() => handleAuditFactoryQtyChange(line)" />
                </a-form-item>
              </a-col>
              <a-col :span="3">
                <a-form-item label="发往条数">
                  <a-input-number v-model:value="allocation.roll_count" style="width: 100%" :min="0" :step="1" />
                </a-form-item>
              </a-col>
              <a-col :span="4">
                <a-form-item label="单位">
                  <a-input :value="normalizeUnit(line.actual_input_unit)" readonly />
                </a-form-item>
              </a-col>
              <a-col :span="5">
                <a-form-item label="操作">
                  <a-button danger @click="removeAuditAllocation(line, allocation.localKey)" :disabled="line.allocations.length === 1">删除去向</a-button>
                </a-form-item>
              </a-col>
            </a-row>
            <div class="bom-row-hint">
              <div>折算实际数量：{{ formatQty(getAuditAllocationActualQty(line, allocation)) }} {{ normalizeUnit(line.actual_input_unit) }}</div>
              <div v-if="Number(allocation.roll_count || 0) > 0">发往条数：{{ formatQty(allocation.roll_count) }} 条</div>
            </div>
          </div>
        </div>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="afterSaleVisible"
      :title="afterSaleType === 'exchange' ? '供应商换货' : '退回供应商'"
      width="920px"
      ok-text="确认"
      cancel-text="取消"
      :confirm-loading="afterSaleSaving"
      @ok="confirmAfterSale"
    >
      <div v-if="afterSaleRecord" class="table-stack table-stack--tight" style="margin-bottom: 12px;">
        <div class="table-primary">采购单号：{{ afterSaleRecord.purchase_order_no || afterSaleRecord.batch_no || '-' }}</div>
        <div class="table-secondary">供应商：{{ afterSaleRecord.supplier || '-' }}，仅支持操作已审核且当前仍在仓库中的数量。</div>
      </div>
      <div v-for="line in afterSaleLines" :key="line.id" class="bom-row" style="margin-bottom: 12px;">
        <div class="sortable-row__bar">
          <span class="sortable-row__title">
            {{ line.material_label }}
            <span v-if="line.color"> / {{ line.color }}</span>
            <span v-if="line.size"> / {{ line.size }}</span>
          </span>
        </div>
        <a-row :gutter="10" class="plan-editor-row">
          <a-col :span="6">
            <a-form-item label="仓库可操作数量">
              <a-input :value="`${formatQty(line.available_qty)} ${normalizeUnit(line.unit)}`" readonly />
            </a-form-item>
          </a-col>
          <a-col :span="5">
            <a-form-item :label="afterSaleType === 'exchange' ? '换货数量' : '退回数量'">
              <a-input-number v-model:value="line.qty" style="width: 100%" :min="0" :max="Number(line.available_qty || 0)" :step="0.0001" />
            </a-form-item>
          </a-col>
          <a-col :span="5">
            <a-form-item label="对应仓库">
              <a-select
                v-model:value="line.warehouse_name"
                allow-clear
                show-search
                placeholder="选择仓库"
                :options="warehouseSelectOptions"
                :filter-option="filterSelectOption"
              />
            </a-form-item>
          </a-col>
          <a-col :span="4">
            <a-form-item label="原因">
              <a-input v-model:value="line.reason" :placeholder="afterSaleType === 'exchange' ? '如色差/换码' : '如退货/质量问题'" />
            </a-form-item>
          </a-col>
          <a-col :span="4">
            <a-form-item label="备注">
              <a-input v-model:value="line.remark" placeholder="补充说明" />
            </a-form-item>
          </a-col>
        </a-row>
      </div>
    </a-modal>

    <a-drawer v-model:open="detailVisible" title="采购批次详情" width="760">
      <div v-if="detailRecord" class="table-stack">
        <div>批次号：{{ detailRecord.batch_no }}</div>
        <div>供应商：{{ detailRecord.supplier || '-' }}</div>
        <div>采购单号：{{ detailRecord.purchase_order_no || '-' }}</div>
        <div>单据状态：{{ documentStatusLabel(detailRecord.document_status) }}</div>
        <div>原料：{{ formatMaterialLabel(detailRecord) }}</div>
        <div>颜色：{{ detailRecord.color || '-' }}</div>
        <div v-if="detailRecord.color_remark">备注：{{ detailRecord.color_remark }}</div>
        <div v-if="detailRecord.size">尺码：{{ detailRecord.size }}</div>
        <div v-if="Number(detailRecord.roll_count || 0) > 0">条数/卷数：{{ formatQty(detailRecord.roll_count) }}</div>
        <div>采购数量：{{ formatQty(detailRecord.purchase_input_qty || detailRecord.gross_qty) }} {{ normalizeUnit(detailRecord.purchase_input_unit || detailRecord.price_unit || detailRecord.unit) }}</div>
        <div>实际数量：{{ formatQty(detailRecord.actual_input_qty || detailRecord.purchase_input_qty || detailRecord.gross_qty) }} {{ normalizeUnit(detailRecord.actual_input_unit || detailRecord.purchase_input_unit || detailRecord.unit) }}</div>
        <div>折合入库：{{ formatQty(detailRecord.gross_qty) }} {{ normalizeUnit(detailRecord.unit) }}</div>
        <div>剩余：{{ formatQty(detailRecord.remaining_qty) }} {{ normalizeUnit(detailRecord.unit) }}</div>
        <div>当前工厂：{{ detailRecord.factory_name || '留仓' }}</div>
        <div v-if="detailRecord.allocations?.length" class="table-secondary">
          去向明细：{{ detailRecord.allocations.map((item) => `${item.factory_name} ${formatQty(item.input_allocated_qty || item.allocated_qty)} ${normalizeUnit(detailRecord.actual_input_unit || detailRecord.purchase_input_unit || detailRecord.unit)}${Number(item.allocated_roll_count || 0) > 0 ? ` / ${formatQty(item.allocated_roll_count)}条` : ''}`).join('；') }}
        </div>
        <div>工厂余量：{{ formatQty(detailRecord.factory_remaining_qty || 0) }} {{ normalizeUnit(detailRecord.unit) }}</div>
        <div>仓库余量：{{ formatQty(detailRecord.warehouse_remaining_qty || detailRecord.remaining_qty || 0) }} {{ normalizeUnit(detailRecord.unit) }}</div>
        <div>单价类型：{{ priceTypeLabel(detailRecord.price_type) }}</div>
        <div>录入单价：{{ formatMoney(detailRecord.price, 4) }} / {{ normalizeUnit(detailRecord.price_unit || detailRecord.unit) }}</div>
        <div>到货日期：{{ detailRecord.received_at || '-' }}</div>
        <div>备注：{{ detailRecord.remark || '-' }}</div>
        <a-divider />
        <div class="section-caption__title" style="margin-bottom: 8px;">审核单据图片</div>
        <div v-if="getDocumentReviewImages(detailRecord).length" class="multi-image-grid">
          <div v-for="(item, index) in getDocumentReviewImages(detailRecord)" :key="`${index}-${item.slice(0, 20)}`" class="multi-image-grid__item">
            <a-popover placement="rightTop" trigger="hover" overlay-class-name="inventory-image-popover">
              <template #content>
                <img :src="item" class="inventory-image-preview inventory-image-preview--full" alt="审核图片预览" />
              </template>
              <img :src="item" class="multi-image-grid__preview" alt="审核图片" @click="openImagePreview(item)" />
            </a-popover>
          </div>
        </div>
        <div v-else class="table-secondary">暂无审核图片</div>
      </div>
    </a-drawer>
    <a-modal v-model:open="previewVisible" title="图片预览" :footer="null" width="960px" centered>
      <div class="image-preview-modal">
        <img v-if="previewImage" :src="previewImage" class="image-preview-modal__img" alt="单据图片预览" />
      </div>
    </a-modal>

    <a-modal
      v-model:open="exportConfigVisible"
      :title="exportModalTitle"
      width="620px"
      @ok="confirmExportWithConfig"
    >
      <a-form layout="vertical">
        <a-form-item label="导出规格">
          <a-select
            v-model:value="exportConfig.layout_mode"
            style="width: 260px"
            :options="exportLayoutOptions"
          />
        </a-form-item>
        <a-form-item label="导出内容">
          <a-space direction="vertical" style="width: 100%">
            <a-checkbox v-model:checked="exportConfig.show_images">显示原料图片</a-checkbox>
            <a-checkbox v-model:checked="exportConfig.show_material_name">显示名称</a-checkbox>
            <a-checkbox v-model:checked="exportConfig.show_color">显示颜色</a-checkbox>
            <a-checkbox v-model:checked="exportConfig.show_price_type">显示单价类型</a-checkbox>
            <a-checkbox v-model:checked="exportConfig.show_unit_price">显示单价</a-checkbox>
            <a-checkbox v-model:checked="exportConfig.show_item_remark">显示每项备注</a-checkbox>
            <a-checkbox v-model:checked="exportConfig.show_order_remark">显示整单备注</a-checkbox>
          </a-space>
        </a-form-item>
        <div class="table-secondary">
          未勾选的字段不会导出，版面会按当前内容自动收缩。采购明细默认列为：序号、原料编码、颜色、采购数量、单位、单价。
        </div>
      </a-form>
    </a-modal>
    </a-card>
  </div>
</template>

<script setup>
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import ColumnConfigButton from '@/components/ColumnConfigButton.vue'
import InlineOptionSelect from '@/components/InlineOptionSelect.vue'
import MobileFilterPanel from '@/components/MobileFilterPanel.vue'
import MultiImageDropInput from '@/components/MultiImageDropInput.vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { useDebouncedInput } from '@/composables/useDebouncedInput'
import { useMobileLayout } from '@/composables/useMobileLayout'
import { api, formatMoney } from '@/utils/api'
import { convertQuantity, normalizeUnit } from '@/utils/material'

const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 260)
const route = useRoute()
const supplierFilter = ref(undefined)
const materialCategoryFilter = ref(undefined)
const documentStatusFilter = ref(undefined)
const dateRange = ref([])
const filterField = ref('keyword')
const visible = ref(false)
const splitVisible = ref(false)
const auditVisible = ref(false)
const afterSaleVisible = ref(false)
const afterSaleSaving = ref(false)
const detailVisible = ref(false)
const purchaseCurrentPage = ref(1)
const purchasePageSize = ref(12)
const purchasePageSizeOptions = [12, 24, 50, 100]

function getPopupContainer(node) {
  return node?.closest?.('.ant-modal-root, .ant-modal-wrap, .erp-page') || document.body
}

const dateRangeStart = computed({
  get: () => Array.isArray(dateRange.value) ? (dateRange.value[0] || undefined) : undefined,
  set: (value) => {
    const end = Array.isArray(dateRange.value) ? (dateRange.value[1] || '') : ''
    dateRange.value = [value || '', end || '']
  }
})

const dateRangeEnd = computed({
  get: () => Array.isArray(dateRange.value) ? (dateRange.value[1] || undefined) : undefined,
  set: (value) => {
    const start = Array.isArray(dateRange.value) ? (dateRange.value[0] || '') : ''
    dateRange.value = [start || '', value || '']
  }
})
const exportConfigVisible = ref(false)
const viewMode = ref(false)
const isEditMode = ref(false)
const dateValue = ref('')
const selectedRowKeys = ref([])
const batchDocumentStatus = ref(undefined)
const sortField = ref('created_at')
const sortOrder = ref('desc')
const list = ref([])
const listLoading = ref(false)
const materials = ref([])
const lines = ref([])
const auditImages = ref([])
const auditTargetIds = ref([])
const detailRecord = ref(null)
const afterSaleRecord = ref(null)
const afterSaleLines = ref([])
const afterSaleType = ref('return')
const currentMergeGroupId = ref('')
const currentMergeSnapshotJson = ref('')
const currentWarehouseName = ref('主仓库')
const previewVisible = ref(false)
const previewImage = ref('')
const exportTargetRecord = ref(null)
const exportTargetIds = ref([])
const exportTargetFormat = ref('pdf')
const baseDataLoadedAt = ref(0)
const purchaseColumnStorageKey = 'purchase.columns'
const purchaseExportConfigStorageKey = 'purchase.export.config'
const purchaseViewStateStorageKey = 'purchase.view.state'
const { isMobileLayout } = useMobileLayout()
let baseDataPromise = null
let listReloadTimer = null
let listLoadToken = 0
const optionLists = ref({ suppliers: [], units: [], factories: [], warehouses: [] })
const PURCHASE_DRAFT_KEY = 'garment-ems:purchase-temp-draft'
const auditLines = ref([])

const form = reactive({ supplier: '', purchase_order_no: '', document_status: 'draft', remark: '', rounding_adjustment: 0, rounding_enabled: false })
const splitForm = reactive({ source_batch_id: null, source_batch_no: '', batch_no: '', split_qty: 0, color: '', processing_cost: 0, remark: '' })
const exportConfig = reactive({
  layout_mode: 'a4',
  show_images: false,
  show_material_name: false,
  show_color: true,
  show_price_type: false,
  show_unit_price: true,
  show_item_remark: false,
  show_order_remark: true
})
const exportLayoutOptions = [
  { label: 'A4 纸大小规格', value: 'a4' },
  { label: 'A5 横版采购单', value: 'card' }
]
const originalLineIds = ref([])

const filterFieldOptions = [
  { label: '按批次/原料', value: 'keyword' },
  { label: '按供应商', value: 'supplier' },
  { label: '按采购单号', value: 'purchase_order_no' },
  { label: '按颜色', value: 'color' },
  { label: '按备注', value: 'remark' }
]
const priceTypeOptions = [{ label: '大货价', value: 'bulk' }, { label: '版布价', value: 'sample' }, { label: '净布价', value: 'net' }]
const documentStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' },
  { label: '已审核', value: 'approved' },
  { label: '已作废', value: 'voided' }
]
const quickDocumentStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' }
]
const sortFieldOptions = [
  { label: '按创建时间', value: 'created_at' },
  { label: '按采购单号', value: 'purchase_order_no' },
  { label: '按供应商', value: 'supplier' },
  { label: '按采购金额', value: 'total_amount' }
]
const sortOrderOptions = [
  { label: '倒序', value: 'desc' },
  { label: '正序', value: 'asc' }
]
const columnDefs = [
  { title: '单号', dataIndex: 'batch_no', key: 'batch_no', width: 170 },
  { title: '原料', key: 'material', width: 180 },
  { title: '供应商 / 单号', key: 'supplier', width: 180 },
  { title: '数量', key: 'qty', width: 180 },
  { title: '价格', key: 'price', width: 180 },
  { title: '到货日期', dataIndex: 'received_at', key: 'received_at', width: 120 },
  { title: '整单备注', key: 'remark', width: 220 },
  { title: '操作', key: 'action', width: 780 }
]

function loadStoredColumnKeys() {
  const allKeys = columnDefs.map((column) => column.key)
  try {
    const parsed = JSON.parse(localStorage.getItem(purchaseColumnStorageKey) || '[]')
    const selected = Array.isArray(parsed) ? parsed.filter((key) => allKeys.includes(key)) : []
    return selected.length ? selected : allKeys
  } catch {
    return allKeys
  }
}

const visibleColumnKeys = ref(loadStoredColumnKeys())
const columns = computed(() => columnDefs.filter((column) => visibleColumnKeys.value.includes(column.key)))

function formatMaterialLabel(item) {
  const code = String(item?.code || item?.material_code || '').trim()
  const name = String(item?.name || item?.material_name || '').trim()
  if (code && name) return `${code} / ${name}`
  return code || name || '-'
}

const materialOptions = computed(() => {
  const supplier = String(form.supplier || '').trim()
  const source = supplier
    ? materials.value.filter((item) => String(item.supplier || '').trim() === supplier)
    : materials.value
  return source.map((item) => ({ label: formatMaterialLabel(item), value: item.id }))
})
const supplierFilterOptions = computed(() =>
  [...new Set(list.value.map((item) => String(item.supplier || '').trim()).filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
)
const materialCategoryFilterOptions = computed(() =>
  [...new Set(list.value.flatMap((item) => [
    item.material_major_category,
    item.material_category,
    item.material_sub_category,
    item.material_leaf_category
  ].map((value) => String(value || '').trim()).filter(Boolean)))]
    .map((item) => ({ label: item, value: item }))
)
const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys) => {
    selectedRowKeys.value = keys
  }
}))
const filterPlaceholder = computed(() => {
  const map = {
    keyword: '搜索批次号 / 原料编码 / 原料名称 / 备注',
    supplier: '搜索供应商',
    purchase_order_no: '搜索采购单号',
    color: '搜索颜色',
    remark: '搜索备注'
  }
  return map[filterField.value] || '搜索'
})

function normalizeFilterText(value) {
  return String(value || '').trim()
}

function recordMatchesKeyword(record, field, keywordText) {
  const source = {
    keyword: [
      record.batch_no,
      record.purchase_order_no,
      record.material_code,
      record.material_name,
      record.color,
      record.supplier,
      record.remark
    ],
    supplier: [record.supplier],
    purchase_order_no: [record.purchase_order_no],
    color: [record.color],
    remark: [record.remark]
  }
  const haystack = (source[field] || source.keyword || [])
    .map((item) => normalizeFilterText(item).toLowerCase())
    .filter(Boolean)
    .join(' ')
  return !keywordText || haystack.includes(keywordText)
}

function recordMatchesCategory(record, categoryValue) {
  if (!categoryValue) return true
  const values = [
    record.material_major_category,
    record.material_category,
    record.material_sub_category,
    record.material_leaf_category
  ]
    .map((item) => normalizeFilterText(item))
    .filter(Boolean)
  return values.includes(normalizeFilterText(categoryValue))
}

function recordMatchesDate(record, from, to) {
  if (!from && !to) return true
  const sourceDate = normalizeFilterText(record.received_at || String(record.created_at || '').slice(0, 10))
  if (!sourceDate) return false
  if (from && sourceDate < from) return false
  if (to && sourceDate > to) return false
  return true
}

const filteredRows = computed(() => {
  const keywordText = normalizeFilterText(keyword.value).toLowerCase()
  const [dateFrom, dateTo] = Array.isArray(dateRange.value) ? dateRange.value : []
  return [...list.value].filter((record) => {
    if (!recordMatchesKeyword(record, filterField.value, keywordText)) return false
    if (supplierFilter.value && normalizeFilterText(record.supplier) !== normalizeFilterText(supplierFilter.value)) return false
    if (!recordMatchesCategory(record, materialCategoryFilter.value)) return false
    if (documentStatusFilter.value && String(record.document_status || 'draft').trim().toLowerCase() !== String(documentStatusFilter.value).trim().toLowerCase()) return false
    if (!recordMatchesDate(record, normalizeFilterText(dateFrom), normalizeFilterText(dateTo))) return false
    return true
  })
})
const exportModalTitle = computed(() => {
  const labelMap = { pdf: 'PDF', excel: 'Excel', image: '图片' }
  const prefix = exportTargetIds.value.length > 1 ? '批量导出采购单设置' : '导出采购单设置'
  return `${prefix}（${labelMap[exportTargetFormat.value] || exportTargetFormat.value}）`
})

function buildExportOptionsPayload() {
  return {
    layout_mode: exportConfig.layout_mode || 'a4',
    show_images: Boolean(exportConfig.show_images),
    show_material_name: Boolean(exportConfig.show_material_name),
    show_color: Boolean(exportConfig.show_color),
    show_price_type: Boolean(exportConfig.show_price_type),
    show_unit_price: Boolean(exportConfig.show_unit_price),
    show_item_remark: Boolean(exportConfig.show_item_remark),
    show_order_remark: Boolean(exportConfig.show_order_remark)
  }
}

function saveStoredExportConfig() {
  try {
    localStorage.setItem(purchaseExportConfigStorageKey, JSON.stringify(buildExportOptionsPayload()))
  } catch {}
}

function loadStoredExportConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(purchaseExportConfigStorageKey) || '{}')
    exportConfig.layout_mode = parsed.layout_mode === 'card' ? 'card' : 'a4'
    exportConfig.show_images = Boolean(parsed.show_images)
    exportConfig.show_material_name = Boolean(parsed.show_material_name)
    exportConfig.show_color = parsed.show_color !== false
    exportConfig.show_price_type = Boolean(parsed.show_price_type)
    exportConfig.show_unit_price = parsed.show_unit_price !== false
    exportConfig.show_item_remark = Boolean(parsed.show_item_remark)
    exportConfig.show_order_remark = parsed.show_order_remark !== false
    return true
  } catch {
    return false
  }
}

function resetExportConfig() {
  exportConfig.layout_mode = 'a4'
  exportConfig.show_images = false
  exportConfig.show_material_name = false
  exportConfig.show_color = true
  exportConfig.show_price_type = false
  exportConfig.show_unit_price = true
  exportConfig.show_item_remark = false
  exportConfig.show_order_remark = true
}

function buildPurchaseGroupKey(item) {
  const mergeGroupId = String(item.merge_group_id || '').trim()
  if (mergeGroupId) return `merge:${mergeGroupId}`

  const purchaseOrderNo = String(item.purchase_order_no || item.batch_no || item.id || '').trim()
  const supplier = String(item.supplier || '').trim() || '-'
  return `${supplier}::${purchaseOrderNo}`
}

function buildPurchaseOrderRemark(rows = []) {
  const remarks = [...new Set(
    (rows || [])
      .map((item) => String(item?.remark || '').trim())
      .filter(Boolean)
  )]
  if (!remarks.length) return ''
  if (remarks.length === 1) return remarks[0]
  return remarks.join('；')
}

const filteredList = computed(() => {
  const groups = new Map()
  for (const row of filteredRows.value) {
    const key = buildPurchaseGroupKey(row)
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        id: Number(row.id),
        group_key: key,
        group_label: row.purchase_order_no || row.batch_no,
        member_ids: [Number(row.id)],
        member_rows: [row],
        remark: buildPurchaseOrderRemark([row])
      })
      continue
    }
    const group = groups.get(key)
    group.member_ids.push(Number(row.id))
    group.member_rows.push(row)
    group.purchase_input_qty = Number(group.purchase_input_qty || 0) + Number(row.purchase_input_qty || row.gross_qty || 0)
    group.actual_input_qty = Number(group.actual_input_qty || 0) + Number(row.actual_input_qty || row.purchase_input_qty || row.gross_qty || 0)
    group.gross_qty = Number(group.gross_qty || 0) + Number(row.gross_qty || 0)
    group.remaining_qty = Number(group.remaining_qty || 0) + Number(row.remaining_qty || 0)
    group.processing_cost = Number(group.processing_cost || 0) + Number(row.processing_cost || 0)
    group.total_amount = Number(group.total_amount || 0) + getLineInputAmount(row)
    group.remark = buildPurchaseOrderRemark(group.member_rows)
  }
  const result = [...groups.values()]
  const direction = sortOrder.value === 'asc' ? 1 : -1
  result.sort((left, right) => {
    if (sortField.value === 'purchase_order_no') {
      return String(left.purchase_order_no || left.batch_no || '').localeCompare(String(right.purchase_order_no || right.batch_no || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'supplier') {
      return String(left.supplier || '').localeCompare(String(right.supplier || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'total_amount') {
      return (Number(left.total_amount || 0) - Number(right.total_amount || 0)) * direction
    }
    return String(left.created_at || '').localeCompare(String(right.created_at || ''), 'zh-Hans-CN', { numeric: true }) * direction
  })
  return result
})

const pagedFilteredList = computed(() => {
  const start = (purchaseCurrentPage.value - 1) * purchasePageSize.value
  return filteredList.value.slice(start, start + purchasePageSize.value)
})

const purchasePagination = computed(() => ({
  current: purchaseCurrentPage.value,
  pageSize: purchasePageSize.value,
  total: filteredList.value.length,
  showSizeChanger: false,
  onChange: (page) => {
    purchaseCurrentPage.value = Number(page || 1)
  }
}))

const summaryItems = computed(() => {
  const totalAmount = filteredRows.value.reduce((sum, item) => sum + getLineInputAmount(item), 0)
  const remainQty = filteredRows.value.reduce((sum, item) => sum + Number(item.remaining_qty || 0), 0)
  const suppliers = new Set(filteredRows.value.map((item) => String(item.supplier || '').trim()).filter(Boolean))
  return [
    { label: '采购单数', value: `${filteredList.value.length} 张`, note: '同采购单多原料合并显示' },
    { label: '供应商数', value: `${suppliers.size} 家`, note: '按当前筛选结果统计' },
    { label: '累计采购额', value: formatMoney(totalAmount, 2), note: '按采购录入数量与录入单价汇总' },
    { label: '当前剩余量', value: formatQty(remainQty), note: '以原料基准单位统计' }
  ]
})

const activePurchaseFilterChips = computed(() => {
  const chips = []
  if (keywordInput.value) chips.push(`关键词：${keywordInput.value}`)
  if (supplierFilter.value) chips.push(`供应商：${supplierFilter.value}`)
  if (materialCategoryFilter.value) chips.push(`分类：${materialCategoryFilter.value}`)
  if (documentStatusFilter.value) chips.push(`单据：${documentStatusLabel(documentStatusFilter.value)}`)
  if (dateRange.value?.filter(Boolean).length) chips.push(`日期：${dateRange.value.filter(Boolean).join(' 至 ')}`)
  return chips
})

function loadStoredViewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(purchaseViewStateStorageKey) || '{}')
    filterField.value = ['keyword', 'supplier', 'purchase_order_no', 'color', 'remark'].includes(parsed.filterField)
      ? parsed.filterField
      : 'keyword'
    keywordInput.value = String(parsed.keyword || '')
    supplierFilter.value = parsed.supplierFilter || undefined
    materialCategoryFilter.value = parsed.materialCategoryFilter || undefined
    documentStatusFilter.value = parsed.documentStatusFilter || undefined
    dateRange.value = Array.isArray(parsed.dateRange) ? parsed.dateRange.filter(Boolean).slice(0, 2) : []
    sortField.value = ['created_at', 'purchase_order_no', 'supplier', 'total_amount'].includes(parsed.sortField)
      ? parsed.sortField
      : 'created_at'
    sortOrder.value = parsed.sortOrder === 'asc' ? 'asc' : 'desc'
    purchaseCurrentPage.value = Number(parsed.purchaseCurrentPage || 1)
    purchasePageSize.value = purchasePageSizeOptions.includes(Number(parsed.purchasePageSize)) ? Number(parsed.purchasePageSize) : 12
  } catch {}
  applyRouteQueryFilters()
}

function applyRouteQueryFilters(query = route.query || {}) {
  if (query.document_status) documentStatusFilter.value = String(query.document_status)
  if (query.q) keywordInput.value = String(query.q)
  if (query.field && ['keyword', 'supplier', 'purchase_order_no', 'color', 'remark'].includes(String(query.field))) {
    filterField.value = String(query.field)
  }
  if (query.action === 'create' && !visible.value) {
    window.setTimeout(() => openCreate(), 0)
  }
}

function clearPurchaseFilters() {
  keywordInput.value = ''
  supplierFilter.value = undefined
  materialCategoryFilter.value = undefined
  documentStatusFilter.value = undefined
  dateRange.value = []
  purchaseCurrentPage.value = 1
}

function saveStoredViewState() {
  try {
    localStorage.setItem(
      purchaseViewStateStorageKey,
      JSON.stringify({
        filterField: filterField.value,
        keyword: keywordInput.value,
        supplierFilter: supplierFilter.value,
        materialCategoryFilter: materialCategoryFilter.value,
        documentStatusFilter: documentStatusFilter.value,
        dateRange: Array.isArray(dateRange.value) ? dateRange.value : [],
        sortField: sortField.value,
        sortOrder: sortOrder.value,
        purchaseCurrentPage: purchaseCurrentPage.value,
        purchasePageSize: purchasePageSize.value
      })
    )
  } catch {}
}

function priceTypeLabel(value) {
  if (value === 'sample') return '版布价'
  if (value === 'net') return '净布价'
  return '大货价'
}

function documentStatusLabel(value) {
  if (value === 'submitted') return '已提交'
  if (value === 'approved') return '已审核'
  if (value === 'voided') return '已作废'
  return '草稿'
}

function getPurchaseRowClassName(record) {
  return record?.document_status === 'voided' ? 'erp-row--voided' : ''
}

function getReviewImages(record) {
  try {
    const parsed = JSON.parse(String(record?.review_images_json || '[]'))
    return Array.isArray(parsed) ? [...new Set(parsed.filter(Boolean))] : []
  } catch {
    return []
  }
}

function getDocumentReviewImages(record) {
  const rows = getDocumentRows(record)
  return [...new Set(rows.flatMap((item) => getReviewImages(item)).filter(Boolean))]
}

function getRecordIds(recordOrIds) {
  if (Array.isArray(recordOrIds)) {
    return [...new Set(recordOrIds.map((item) => Number(item)).filter(Boolean))]
  }
  if (!recordOrIds) return []
  return [...new Set((recordOrIds.member_ids || [recordOrIds.id]).map((item) => Number(item)).filter(Boolean))]
}

function getDocumentRows(record) {
  return (record?.member_rows && record.member_rows.length)
    ? [...record.member_rows]
    : list.value.filter((item) => getRecordIds(record).includes(Number(item.id)))
}

function getMergeGroupIdForRecord(record) {
  const groupIds = [...new Set(
    getDocumentRows(record)
      .map((item) => String(item?.merge_group_id || '').trim())
      .filter(Boolean)
  )]
  return groupIds.length === 1 ? groupIds[0] : ''
}

function canUnmergeRecord(record) {
  const rows = getDocumentRows(record)
  if (rows.length < 2) return false
  return Boolean(getMergeGroupIdForRecord(record))
}

const canBatchUnmerge = computed(() => {
  const selectedRecords = filteredList.value.filter((item) => selectedRowKeys.value.includes(item.id))
  if (!selectedRecords.length) return false
  const groupIds = [...new Set(selectedRecords.map((item) => getMergeGroupIdForRecord(item)).filter(Boolean))]
  return groupIds.length === 1
})

function expandSelectedIds(ids = selectedRowKeys.value) {
  const normalized = [...new Set((ids || []).map((item) => Number(item)).filter(Boolean))]
  const matchedGroups = filteredList.value.filter((item) => normalized.includes(Number(item.id)))
  if (!matchedGroups.length) return normalized
  return [...new Set(matchedGroups.flatMap((item) => getRecordIds(item)))]
}

function getSupplierMismatchLines(sourceLines) {
  const targetSupplier = String(form.supplier || '').trim()
  if (!targetSupplier) return []
  return (sourceLines || []).filter((line) => {
    const material = resolveLineMaterial(line)
    const materialSupplier = String(material?.supplier || '').trim()
    return materialSupplier && materialSupplier !== targetSupplier
  })
}

function confirmSupplierMismatchRemoval(mismatchLines) {
  const names = mismatchLines
    .map((line) => {
      const material = resolveLineMaterial(line)
      return `${material?.code || ''}${material?.name ? ` / ${material.name}` : ''}`
    })
    .filter(Boolean)
  const preview = names.slice(0, 4).join('、')
  const extra = names.length > 4 ? ` 等 ${names.length} 项` : ''
  return new Promise((resolve) => {
    Modal.confirm({
      title: '该采购单包含非该供应商产品',
      content: `当前采购单里有不属于“${form.supplier}”的原料：${preview}${extra}。是否删除这些不匹配原料后再保存？`,
      okText: '删除后保存',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    })
  })
}

function createLine(data = {}) {
  const normalized = {
    localKey: `${Date.now()}-${Math.random()}`,
    id: data.id || null,
    batch_no: data.batch_no || '',
    merge_group_id: data.merge_group_id || '',
    merge_snapshot_json: data.merge_snapshot_json || '',
    warehouse_name: data.warehouse_name || '',
    material_id: data.material_id || null,
    color: data.color || '',
    size: data.size || '',
    roll_count: Number(data.roll_count || 0),
    purchase_input_qty: Number(data.purchase_input_qty ?? data.gross_qty ?? 0),
    purchase_input_unit: normalizeUnit(data.purchase_input_unit || data.price_unit || data.unit || '米'),
    price_type: data.price_type || 'bulk',
    price_unit: normalizeUnit(data.price_unit || data.unit || '米'),
    price: normalizePurchaseUnitPrice(data.price),
    price_manually_edited: false,
    processing_cost: Number(data.processing_cost || 0),
    processing_note: data.processing_note || '',
    color_remark: data.color_remark || '',
    remark: data.remark || ''
  }
  return normalized
}

function normalizeDraftLine(line = {}) {
  const next = createLine(line)
  const material = resolveLineMaterial(next)
  if (material) {
    next.purchase_input_unit = normalizeUnit(next.purchase_input_unit || material.unit || '米')
    next.price_unit = normalizeUnit(next.price_unit || material.unit || '米')
  }
  if (!next.price_type) next.price_type = 'bulk'
  return next
}

function getPurchaseLinesWithMaterial(sourceLines = lines.value) {
  return (sourceLines || []).filter((item) => item && item.material_id)
}

function validatePurchaseLines(sourceLines = lines.value) {
  const materialLines = getPurchaseLinesWithMaterial(sourceLines)
  if (!materialLines.length) {
    throw new Error('请至少填写一条采购明细')
  }
  const invalidQtyIndex = sourceLines.findIndex((item) => item?.material_id && Number(item.purchase_input_qty || 0) <= 0)
  if (invalidQtyIndex >= 0) {
    throw new Error(`请填写采购明细 ${invalidQtyIndex + 1} 的采购数量`)
  }
  return materialLines
}

function resetForm() {
  form.supplier = ''
  form.purchase_order_no = ''
  form.document_status = 'draft'
  form.remark = ''
  form.rounding_adjustment = 0
  form.rounding_enabled = false
  dateValue.value = ''
  currentMergeGroupId.value = ''
  currentMergeSnapshotJson.value = ''
  currentWarehouseName.value = '主仓库'
  lines.value = [createLine()]
  isEditMode.value = false
  originalLineIds.value = []
}

function buildDraftPayload() {
  return {
    savedAt: Date.now(),
    mode: isEditMode.value ? 'edit' : 'create',
    form: {
      supplier: form.supplier,
      purchase_order_no: form.purchase_order_no,
      document_status: form.document_status,
      remark: form.remark,
      merge_group_id: currentMergeGroupId.value,
      merge_snapshot_json: currentMergeSnapshotJson.value,
      warehouse_name: currentWarehouseName.value,
      rounding_enabled: Boolean(form.rounding_enabled)
    },
    dateValue: dateValue.value || '',
    lines: lines.value.map((line) => ({
      id: line.id || null,
      batch_no: line.batch_no || '',
      merge_group_id: line.merge_group_id || currentMergeGroupId.value || '',
      merge_snapshot_json: line.merge_snapshot_json || currentMergeSnapshotJson.value || '',
      warehouse_name: line.warehouse_name || currentWarehouseName.value || '主仓库',
      material_id: line.material_id || null,
      color: line.color || '',
      color_remark: line.color_remark || '',
      size: line.size || '',
      roll_count: Number(line.roll_count || 0),
      purchase_input_qty: Number(line.purchase_input_qty || 0),
      purchase_input_unit: line.purchase_input_unit || '',
      price_type: line.price_type || 'bulk',
      price_unit: line.price_unit || '',
      price: normalizePurchaseUnitPrice(line.price),
      processing_cost: Number(line.processing_cost || 0),
      processing_note: line.processing_note || '',
      remark: line.remark || ''
    }))
  }
}

function getTempDraft() {
  try {
    const raw = window.localStorage.getItem(PURCHASE_DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearTempDraft() {
  window.localStorage.removeItem(PURCHASE_DRAFT_KEY)
}

function applyTempDraft(draft) {
  resetForm()
  form.supplier = draft?.form?.supplier || ''
  form.purchase_order_no = draft?.form?.purchase_order_no || ''
  form.document_status = draft?.form?.document_status || 'draft'
  form.remark = draft?.form?.remark || ''
  currentMergeGroupId.value = draft?.form?.merge_group_id || ''
  currentMergeSnapshotJson.value = draft?.form?.merge_snapshot_json || ''
  currentWarehouseName.value = draft?.form?.warehouse_name || '主仓库'
  form.rounding_enabled = Boolean(draft?.form?.rounding_enabled)
  dateValue.value = draft?.dateValue || ''
  lines.value = Array.isArray(draft?.lines) && draft.lines.length
    ? draft.lines.map((item) => normalizeDraftLine(item))
    : [createLine()]
  isEditMode.value = draft?.mode === 'edit'
  viewMode.value = false
  visible.value = true
}

function promptRestoreTempDraft() {
  const draft = getTempDraft()
  if (!draft) {
    visible.value = true
    return
  }
  Modal.confirm({
    title: '检测到临时草稿',
    content: '当前模块已有一张临时草稿，是否恢复继续填写？',
    okText: '恢复草稿',
    cancelText: '新建空白',
    onOk: () => applyTempDraft(draft),
    onCancel: () => {
      visible.value = true
    }
  })
}

function saveTempDraft() {
  const nextDraft = buildDraftPayload()
  const existing = getTempDraft()
  const writeDraft = () => {
    window.localStorage.setItem(PURCHASE_DRAFT_KEY, JSON.stringify(nextDraft))
    message.success('采购单临时草稿已保存')
  }
  if (existing) {
    Modal.confirm({
      title: '已存在临时草稿',
      content: '保存新的临时草稿会覆盖上一张草稿，是否继续？',
      okText: '覆盖保存',
      cancelText: '取消',
      onOk: writeDraft
    })
    return
  }
  writeDraft()
}

function handleOptionsUpdated(nextLists) {
  optionLists.value = nextLists
}

function resolveLineMaterial(line) {
  return materials.value.find((item) => item.id === line.material_id)
}

function isCupMaterialByMaterial(material) {
  return [material?.category, material?.sub_category, material?.leaf_category]
    .some((item) => String(item || '').trim() === '胸杯')
}

function isCupMaterial(line) {
  return isCupMaterialByMaterial(resolveLineMaterial(line))
}

function getColorOptions(materialId) {
  return (resolveLineMaterial({ material_id: materialId })?.colorProfiles || []).map((item) => ({ value: item.color }))
}

function getSizeOptions(materialId, currentValue = '') {
  const material = resolveLineMaterial({ material_id: materialId })
  const profileSizes = (material?.colorProfiles || []).flatMap((profile) =>
    Array.isArray(profile?.sizePrices) ? profile.sizePrices.map((item) => item?.size) : []
  )
  const directSizes = Array.isArray(material?.sizePrices) ? material.sizePrices.map((item) => item?.size) : []
  return [...new Set([
    ...((material?.allSizes || []).map((item) => String(item || '').trim())),
    ...directSizes.map((item) => String(item || '').trim()),
    ...profileSizes.map((item) => String(item || '').trim()),
    String(currentValue || '').trim()
  ])]
    .filter(Boolean)
    .map((item) => ({ label: item, value: item }))
}

function getPurchaseUnitOptions(materialId) {
  const material = resolveLineMaterial({ material_id: materialId })
  if (!material) return [{ label: '米', value: '米' }]
  const units = material.major_category === '面料'
    ? ['公斤', '米', '码', material.unit]
    : [material.unit]
  return [...new Set(units.map((item) => normalizeUnit(item)).filter(Boolean))].map((item) => ({ label: item, value: item }))
}

function getActualInputUnit(line) {
  return normalizeUnit(line.purchase_input_unit || resolveLineMaterial(line)?.unit || '米')
}

function getActualInputQty(line) {
  const material = resolveLineMaterial(line)
  const purchaseQty = Number(line.purchase_input_qty || 0)
  if (!material || !purchaseQty) return 0
  if (String(line.price_type || '') === 'sample') {
    return Number(purchaseQty.toFixed(6))
  }
  const adjustmentType = String(material.adjustment_type || 'none')
  if (adjustmentType === 'rate') {
    const rawRatio = Number(material.gap_ratio || 0)
    const ratio = rawRatio > 1 ? rawRatio / 100 : rawRatio
    return Number((purchaseQty * (ratio > 0 ? ratio : 1)).toFixed(6))
  }
  if (adjustmentType === 'weight_gap') {
    const deductionPerRoll = Math.max(Number(material.left_gap || 0), 0) + Math.max(Number(material.right_gap || 0), 0)
    const rollCount = Math.max(Number(line.roll_count || 0), 0)
    if (rollCount > 0 && deductionPerRoll > 0) {
      return Number(Math.max(purchaseQty - rollCount * deductionPerRoll, 0).toFixed(6))
    }
  }
  return Number(purchaseQty.toFixed(6))
}

function getConvertedBaseQty(line) {
  const material = resolveLineMaterial(line)
  if (!material) return 0
  return convertQuantity(getActualInputQty(line), getActualInputUnit(line), material.unit, material)
}

function getPricedQty(line) {
  const material = resolveLineMaterial(line)
  if (!material) return 0
  try {
    return convertQuantity(Number(line.purchase_input_qty || 0), normalizeUnit(line.purchase_input_unit || material.unit), line.price_unit || material.unit, material)
  } catch {
    return 0
  }
}

function getLineInputAmount(line) {
  return getLineGoodsAmount(line) + getLineProcessingAmount(line) + Number(line.rounding_adjustment || 0)
}

function getLineGoodsAmount(line) {
  return Number(getPricedQty(line) || 0) * Number(line.price || 0)
}

function getLineProcessingAmount(line) {
  return Number(line.processing_cost || 0)
}

function getDocumentInputAmount(sourceLines = lines.value) {
  return (sourceLines || []).reduce((sum, line) => sum + getLineGoodsAmount(line) + getLineProcessingAmount(line), 0)
}

function getDocumentRoundingAdjustment(sourceLines = lines.value) {
  const total = getDocumentInputAmount(sourceLines)
  if (!form.rounding_enabled || total <= 0) return 0
  return Number((Math.round(total) - total).toFixed(2))
}

function getDocumentRoundedTotal(sourceLines = lines.value) {
  return getDocumentInputAmount(sourceLines) + getDocumentRoundingAdjustment(sourceLines)
}

function formatSignedMoney(value, digits = 2) {
  const amount = Number(value || 0)
  return `${amount > 0 ? '+' : amount < 0 ? '' : ''}${formatMoney(amount, digits)}`
}

function normalizePurchaseUnitPrice(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return 0
  const rounded4 = Number(number.toFixed(4))
  if (Math.abs(number - rounded4) < 0.00001) return rounded4
  return Number(number.toFixed(6))
}

function getDefaultPriceConfig(material, line, preferredUnit = '') {
  const fallbackPrice = Number(material?.default_price || 0)
  const fallbackUnit = normalizeUnit(material?.default_price_unit || material?.unit)
  const fallbackConfig = {
    price: normalizePurchaseUnitPrice(fallbackPrice),
    unit: fallbackUnit
  }

  const profiles = material?.colorProfiles || []
  const matchedProfile = profiles.find((item) => String(item.color || '').trim() === String(line.color || '').trim()) || profiles[0]

  if (isCupMaterialByMaterial(material)) {
    const sizeList = Array.isArray(matchedProfile?.sizePrices) && matchedProfile.sizePrices.length
      ? matchedProfile.sizePrices
      : (Array.isArray(material?.sizePrices) ? material.sizePrices : [])
    const normalizedSize = String(line.size || '').trim()
    const matchedSize = sizeList.find((item) => String(item.size || '').trim() === normalizedSize)
    const fallbackSize = !normalizedSize ? sizeList.find((item) => Number(item?.price || 0) > 0) : null
    const sizePrice = matchedSize || fallbackSize
    if (Number(sizePrice?.price || 0) > 0) {
      return {
        price: normalizePurchaseUnitPrice(sizePrice?.price),
        unit: normalizeUnit(sizePrice?.unit || matchedProfile?.default_price_unit || material.default_price_unit || material.unit)
      }
    }
    if (Number(matchedProfile?.default_price || 0) > 0) {
      return {
        price: normalizePurchaseUnitPrice(matchedProfile.default_price),
        unit: normalizeUnit(matchedProfile.default_price_unit || material.default_price_unit || material.unit)
      }
    }
    return fallbackConfig
  }

  const target = matchedProfile
  if (!target) return fallbackConfig
  if (line.price_type === 'sample') {
    const sampleCandidates = [
      { price: normalizePurchaseUnitPrice(target.sample_price_meter), unit: '米' },
      { price: normalizePurchaseUnitPrice(target.sample_price_yard), unit: '码' }
    ].filter((item) => item.price > 0)
    const matched = sampleCandidates.find((item) => item.unit === normalizeUnit(preferredUnit))
    if (matched) return matched
    if (sampleCandidates.length) return sampleCandidates[0]
    return fallbackConfig
  }
  if (line.price_type === 'net') {
    if (Number(target.net_price_meter || 0) > 0) {
      return { price: normalizePurchaseUnitPrice(target.net_price_meter), unit: '米' }
    }
    return fallbackConfig
  }
  const bulkCandidates = [
    { price: normalizePurchaseUnitPrice(target.bulk_price_kg), unit: '公斤' },
    { price: normalizePurchaseUnitPrice(target.bulk_price_meter), unit: '米' },
    { price: normalizePurchaseUnitPrice(target.bulk_price_yard), unit: '码' }
  ].filter((item) => item.price > 0)
  const matchedBulk = bulkCandidates.find((item) => item.unit === normalizeUnit(preferredUnit))
  if (matchedBulk) return matchedBulk
  if (bulkCandidates.length) return bulkCandidates[0]
  if (Number(target.default_price || 0) > 0) {
    return {
      price: normalizePurchaseUnitPrice(target.default_price),
      unit: normalizeUnit(target.default_price_unit || material.default_price_unit || material.unit)
    }
  }
  return fallbackConfig
}

function syncPriceUnit(line) {
  if (!line.price_unit) line.price_unit = line.purchase_input_unit
}

function applyMaterialDefaults(line, options = {}) {
  const {
    forcePrice = false,
    resetManual = false,
    syncPriceUnitToPurchaseUnit = false
  } = options
  const material = resolveLineMaterial(line)
  if (!material) return
  const unitOptions = getPurchaseUnitOptions(material.id).map((item) => item.value)
  if (!unitOptions.includes(line.purchase_input_unit)) line.purchase_input_unit = unitOptions[0]
  if (isCupMaterialByMaterial(material)) {
    const sizeOptions = getSizeOptions(material.id, line.size).map((item) => item.value)
    if (!sizeOptions.includes(line.size)) line.size = sizeOptions[0] || ''
  } else {
    line.size = ''
  }
  if (syncPriceUnitToPurchaseUnit && unitOptions.includes(line.purchase_input_unit)) {
    line.price_unit = line.purchase_input_unit
  }
  const currentPreferredUnit = unitOptions.includes(line.price_unit) ? line.price_unit : line.purchase_input_unit
  const priceConfig = getDefaultPriceConfig(material, line, currentPreferredUnit)
  if (!unitOptions.includes(line.price_unit) || (forcePrice && priceConfig.unit)) line.price_unit = priceConfig.unit
  if (resetManual) line.price_manually_edited = false
  if (forcePrice || !line.price_manually_edited || !Number(line.price || 0)) {
    line.price = normalizePurchaseUnitPrice(priceConfig.price)
  }
}

function handleMaterialOrColorChange(line) {
  applyMaterialDefaults(line, { forcePrice: true, resetManual: true })
}

function handlePurchaseUnitChange(line) {
  syncPriceUnit(line)
  if (!line.price_manually_edited) {
    applyMaterialDefaults(line, { forcePrice: true, syncPriceUnitToPurchaseUnit: true })
  }
}

function handlePriceTypeChange(line) {
  applyMaterialDefaults(line, { forcePrice: true, resetManual: true })
}

function handlePriceUnitChange(line) {
  applyMaterialDefaults(line, { forcePrice: true, resetManual: true })
}

function handleSizeChange(line) {
  applyMaterialDefaults(line, { forcePrice: true, resetManual: true })
}

function markPriceAsManual(line) {
  line.price_manually_edited = true
}

function addLine() {
  lines.value.push(createLine())
}

function removeLine(index) {
  if (lines.value.length === 1) return
  lines.value.splice(index, 1)
}

function createAuditLine(row) {
  const material = materials.value.find((item) => Number(item.id) === Number(row.material_id)) || {}
  const sourceUnit = normalizeUnit(row.unit || material.unit || row.actual_input_unit || row.purchase_input_unit || '米')
  const inputUnit = normalizeUnit(row.actual_input_unit || row.purchase_input_unit || sourceUnit)
  const actualInputQty = Number(row.actual_input_qty || row.purchase_input_qty || row.gross_qty || 0)
  const allocations = Array.isArray(row.allocations) && row.allocations.length
    ? row.allocations.map((item) => {
        let qty = 0
        try {
          qty = convertQuantity(Number(item.allocated_qty || 0), sourceUnit, inputUnit, material)
        } catch {
          qty = 0
        }
        return {
          localKey: `${Date.now()}-${Math.random()}`,
          factory_name: String(item.factory_name || '').trim(),
          qty: Number(qty || 0),
          roll_count: Number(item.allocated_roll_count || 0)
        }
      })
    : [{ localKey: `${Date.now()}-${Math.random()}`, factory_name: String(row.factory_name || '').trim(), qty: 0, roll_count: 0 }]
  return {
    id: Number(row.id),
    batch_no: row.batch_no || '',
    material_id: Number(row.material_id || 0),
    material_label: formatMaterialLabel(row),
    color: row.color || '',
    size: row.size || '',
    roll_count: Number(row.roll_count || 0),
    actual_input_qty: actualInputQty,
    actual_input_unit: inputUnit,
    warehouse_name: String(row.warehouse_name || '').trim() || '主仓库',
    allocations
  }
}

function buildAfterSaleLine(row) {
  const actualUnit = normalizeUnit(row.actual_input_unit || row.purchase_input_unit || row.unit)
  const warehouseRemainingQty = Number(row.warehouse_remaining_qty ?? Math.max(Number(row.remaining_qty || 0) - Number(row.factory_allocated_qty || 0), 0))
  return {
    id: Number(row.id || 0),
    material_label: formatMaterialLabel(row),
    color: row.color || '',
    size: row.size || '',
    unit: actualUnit,
    available_qty: Number(Math.max(warehouseRemainingQty, 0).toFixed(4)),
    warehouse_name: String(row.warehouse_name || '').trim() || '主仓库',
    qty: 0,
    reason: '',
    remark: ''
  }
}

function getAuditAllocationActualQty(line, allocation) {
  const totalRollCount = Number(line.roll_count || 0)
  const allocatedRollCount = Number(allocation?.roll_count || 0)
  const actualQty = Number(line.actual_input_qty || 0)
  if (totalRollCount > 0 && allocatedRollCount > 0 && actualQty > 0) {
    return Number((actualQty * allocatedRollCount / totalRollCount).toFixed(4))
  }
  return Number(allocation?.qty || 0)
}

function getAuditAllocatedQty(line) {
  return Number((line.allocations || []).reduce((sum, item) => sum + getAuditAllocationActualQty(line, item), 0))
}

function getAuditWarehouseQty(line) {
  return Math.max(Number(line.actual_input_qty || 0) - getAuditAllocatedQty(line), 0)
}

function addAuditAllocation(line) {
  line.allocations.push({ localKey: `${Date.now()}-${Math.random()}`, factory_name: '', qty: 0, roll_count: 0 })
}

function removeAuditAllocation(line, localKey) {
  if ((line.allocations || []).length === 1) {
    line.allocations[0].factory_name = ''
    line.allocations[0].qty = 0
    line.allocations[0].roll_count = 0
    return
  }
  line.allocations = line.allocations.filter((item) => item.localKey !== localKey)
}

function handleAuditFactoryQtyChange(line) {
  const actualQty = Number(line.actual_input_qty || 0)
  line.allocations.forEach((item) => {
    if (Number(item.qty || 0) < 0) item.qty = 0
    if (Number(item.qty || 0) <= 0) item.factory_name = ''
  })
  const totalAllocated = getAuditAllocatedQty(line)
  if (totalAllocated > actualQty && line.allocations.length) {
    const overflow = totalAllocated - actualQty
    const last = line.allocations[line.allocations.length - 1]
    last.qty = Math.max(Number(last.qty || 0) - overflow, 0)
    if (Number(last.qty || 0) <= 0) last.factory_name = ''
  }
}

async function loadBaseData(force = false) {
  if (baseDataPromise) return baseDataPromise
  if (!force && materials.value.length && Date.now() - baseDataLoadedAt.value < 60000) return
  baseDataPromise = Promise.all([api.db.getMaterials(), api.db.getOptionLists()])
    .then(([materialList, options]) => {
      materials.value = materialList || []
      optionLists.value = options || { suppliers: [], units: [], factories: [], warehouses: [] }
      baseDataLoadedAt.value = Date.now()
    })
    .finally(() => {
      baseDataPromise = null
    })
  return baseDataPromise
}

async function loadList() {
  const token = ++listLoadToken
  listLoading.value = true
  try {
    const [dateFrom, dateTo] = Array.isArray(dateRange.value) ? dateRange.value : []
    const batches = await api.db.getPurchaseBatches({
      filterField: filterField.value,
      keyword: keyword.value,
      supplier: supplierFilter.value,
      material_category: materialCategoryFilter.value,
      document_status: documentStatusFilter.value,
      date_from: dateFrom || '',
      date_to: dateTo || '',
      limit: 1200
    })
    if (token === listLoadToken) {
      const nextList = batches || []
      list.value = nextList
      selectedRowKeys.value = selectedRowKeys.value.filter((id) => nextList.some((item) => item.id === id))
    }
  } catch (error) {
    message.error(error.message || '加载采购批次失败')
  } finally {
    if (token === listLoadToken) listLoading.value = false
  }
}

function scheduleListReload(delay = 100) {
  if (listReloadTimer) clearTimeout(listReloadTimer)
  listReloadTimer = setTimeout(() => {
    loadList()
  }, delay)
}

async function applyBatchDocumentStatus() {
  if (!selectedRowKeys.value.length || !batchDocumentStatus.value) return
  try {
    await api.db.batchUpdatePurchaseBatchDocumentStatus(JSON.parse(JSON.stringify({
      ids: expandSelectedIds(selectedRowKeys.value),
      document_status: batchDocumentStatus.value
    })))
    message.success('勾选采购批次的单据状态已更新')
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '批量修改采购单据状态失败')
  }
}

async function updateSingleDocumentStatus(record, value) {
  if (!value) return
  try {
    await api.db.batchUpdatePurchaseBatchDocumentStatus(JSON.parse(JSON.stringify({
      ids: getRecordIds(record),
      document_status: value
    })))
    message.success('采购单据状态已更新')
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '修改采购单据状态失败')
  }
}

function openAuditModal(ids = []) {
  const rows = typeof ids === 'object' && ids !== null && !Array.isArray(ids)
    ? getDocumentRows(ids)
    : list.value.filter((item) => getRecordIds(ids).includes(Number(item.id)))
  auditTargetIds.value = getRecordIds(ids)
  auditLines.value = rows.map((row) => createAuditLine(row))
  auditImages.value = []
  auditVisible.value = true
}

function openAfterSaleModal(record, type = 'return') {
  const rows = getDocumentRows(record).filter((item) => String(item.document_status || '').trim() === 'approved')
  if (!rows.length) {
    message.error('仅支持对已审核采购单执行退回或换货')
    return
  }
  afterSaleType.value = type === 'exchange' ? 'exchange' : 'return'
  afterSaleRecord.value = record
  afterSaleLines.value = rows.map((row) => buildAfterSaleLine(row))
  afterSaleVisible.value = true
}

async function confirmAfterSale() {
  const linesPayload = afterSaleLines.value
    .map((item) => ({
      id: Number(item.id || 0),
      qty: Number(item.qty || 0),
      warehouse_name: item.warehouse_name || '主仓库',
      reason: item.reason || '',
      remark: item.remark || ''
    }))
    .filter((item) => item.id && item.qty > 0)

  if (!linesPayload.length) {
    message.error(`请至少填写一条${afterSaleType.value === 'exchange' ? '换货' : '退回'}明细`)
    return
  }

  afterSaleSaving.value = true
  try {
    await api.db.processPurchaseBatchAfterSale(JSON.parse(JSON.stringify({
      type: afterSaleType.value,
      lines: linesPayload
    })))
    message.success(afterSaleType.value === 'exchange' ? '供应商换货已登记' : '退回供应商已登记')
    afterSaleVisible.value = false
    afterSaleRecord.value = null
    afterSaleLines.value = []
    scheduleListReload()
  } catch (error) {
    message.error(error?.message || '处理采购退回/换货失败')
  } finally {
    afterSaleSaving.value = false
  }
}

async function confirmAudit() {
  if (!auditTargetIds.value.length) return
  if (!auditImages.value.length) {
    message.error('审核前请先插入采购单或收货单图片')
    return
  }
  try {
    await api.db.approvePurchaseBatches(JSON.parse(JSON.stringify({
      ids: [...auditTargetIds.value],
      review_images_json: JSON.stringify(auditImages.value || []),
      allocations: auditLines.value.map((item) => ({
        id: item.id,
        warehouse_name: item.warehouse_name || '主仓库',
        allocations: (item.allocations || []).map((allocation) => ({
          factory_name: allocation.factory_name || '',
          factory_allocated_qty: Number(allocation.qty || 0),
          factory_allocated_roll_count: Number(allocation.roll_count || 0),
          factory_allocated_unit: item.actual_input_unit || ''
        }))
      }))
    })))
    message.success('采购单已审核')
    auditVisible.value = false
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '审核采购单失败')
  }
}

async function handleBatchAudit() {
  const targets = filteredList.value.filter((item) => selectedRowKeys.value.includes(item.id))
  if (!targets.length) return
  const missingImages = targets.filter((item) => getDocumentRows(item).some((row) => !getReviewImages(row).length))
  if (missingImages.length) {
    message.error('批量审核前，请先逐单在详情中插入单据图片')
    return
  }
  try {
    await api.db.approvePurchaseBatches(JSON.parse(JSON.stringify({
      ids: [...new Set(targets.flatMap((item) => getRecordIds(item)))]
    })))
    message.success('勾选采购单已批量审核')
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '批量审核采购单失败')
  }
}

async function voidSelected(ids = selectedRowKeys.value) {
  const targetIds = Array.isArray(ids) && ids.length && typeof ids[0] === 'object'
    ? [...new Set(ids.flatMap((item) => getRecordIds(item)))]
    : expandSelectedIds(ids)
  if (!targetIds.length) return
  try {
    await api.db.voidPurchaseBatches(JSON.parse(JSON.stringify({ ids: targetIds })))
    message.success('采购单已作废')
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '作废采购单失败')
  }
}

function getPurchaseMergeApi() {
  const fn = api?.db?.mergePurchaseBatches || window?.electronAPI?.db?.mergePurchaseBatches
  if (typeof fn !== 'function') {
    throw new Error('当前版本不支持采购单合并，请更新到最新版本后重试')
  }
  return fn
}

function getPurchaseUnmergeApi() {
  const fn = api?.db?.unmergePurchaseBatches || window?.electronAPI?.db?.unmergePurchaseBatches
  if (typeof fn !== 'function') {
    throw new Error('当前版本不支持取消合并，请更新到最新版本后重试')
  }
  return fn
}

async function mergeSelectedPurchaseOrders() {
  const selectedRecords = filteredList.value.filter((item) => selectedRowKeys.value.includes(item.id))
  if (selectedRecords.length < 2) return

  const suppliers = [...new Set(selectedRecords.map((item) => String(item.supplier || '').trim()).filter(Boolean))]
  if (suppliers.length !== 1) {
    message.error('仅支持合并同一供应商的采购单')
    return
  }

  const invalidStatus = selectedRecords.find((item) => ['approved', 'voided'].includes(String(item.document_status || '').trim()))
  if (invalidStatus) {
    message.error('已审核或已作废的采购单不能合并')
    return
  }

  const sortedTargets = [...selectedRecords].sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
  const targetRecord = sortedTargets[0]
  const targetIds = expandSelectedIds([targetRecord.id])
  const sourceIds = expandSelectedIds(selectedRowKeys.value).filter((id) => !targetIds.includes(id))
  if (!sourceIds.length) {
    message.error('请至少勾选两张不同的采购单再合并')
    return
  }

  Modal.confirm({
    title: '确认合并采购单？',
    content: `将把已勾选采购单合并到【${targetRecord.purchase_order_no || targetRecord.batch_no}】下，供应商保持为“${suppliers[0]}”。`,
    okText: '确认合并',
    cancelText: '取消',
    onOk: async () => {
      try {
        const mergeFn = getPurchaseMergeApi()
        const result = await mergeFn(JSON.parse(JSON.stringify({
          target_ids: targetIds,
          source_ids: sourceIds
        })))
        message.success(`已合并 ${Number(result?.merged_documents || 1)} 张采购单`)
        selectedRowKeys.value = []
        scheduleListReload()
      } catch (error) {
        message.error(error.message || '合并采购单失败')
      }
    }
  })
}

async function unmergeSelectedPurchaseOrders(ids = selectedRowKeys.value) {
  const targetIds = Array.isArray(ids) && ids.length && typeof ids[0] === 'object'
    ? [...new Set(ids.flatMap((item) => getRecordIds(item)))]
    : expandSelectedIds(ids)
  if (!targetIds.length) return

  const selectedRecords = filteredList.value.filter((item) =>
    targetIds.some((id) => getRecordIds(item).includes(Number(id)))
  )
  const groupIds = [...new Set(selectedRecords.map((item) => getMergeGroupIdForRecord(item)).filter(Boolean))]
  if (groupIds.length !== 1) {
    message.error('请先选择同一组合并后的采购单')
    return
  }

  Modal.confirm({
    title: '确认取消合并采购单？',
    content: '系统会恢复到合并前的采购单号、备注、供应商、日期和四舍五入状态。',
    okText: '确认恢复',
    cancelText: '取消',
    onOk: async () => {
      try {
        const unmergeFn = getPurchaseUnmergeApi()
        const result = await unmergeFn(JSON.parse(JSON.stringify({ ids: targetIds })))
        message.success(`已恢复 ${Number(result?.restored_documents || 0)} 张采购单`)
        selectedRowKeys.value = []
        scheduleListReload()
      } catch (error) {
        message.error(error.message || '取消合并采购单失败')
      }
    }
  })
}

async function returnSelectedToDraft(ids = selectedRowKeys.value) {
  const targetIds = Array.isArray(ids) && ids.length && typeof ids[0] === 'object'
    ? [...new Set(ids.flatMap((item) => getRecordIds(item)))]
    : expandSelectedIds(ids)
  if (!targetIds.length) return
  Modal.confirm({
    title: '确认将所选采购单退回草稿？',
    content: '退回后可继续修改采购明细、金额和备注。',
    okText: '确认退回',
    cancelText: '取消',
    onOk: async () => {
      try {
        await api.db.returnPurchaseBatchesToDraft(JSON.parse(JSON.stringify({ ids: targetIds })))
        message.success('采购单已退回草稿')
        scheduleListReload()
      } catch (error) {
        message.error(error.message || '退回草稿失败')
      }
    }
  })
}

function openImagePreview(image) {
  previewImage.value = String(image || '')
  previewVisible.value = Boolean(previewImage.value)
}

function openDetail(record) {
  resetForm()
  viewMode.value = true
  isEditMode.value = true
  const rows = getDocumentRows(record)
  const seed = rows[0] || record
  detailRecord.value = { ...seed, member_rows: rows }
  form.supplier = seed.supplier || ''
  form.purchase_order_no = seed.purchase_order_no || ''
  form.document_status = seed.document_status || 'draft'
  form.remark = buildPurchaseOrderRemark(rows)
  currentMergeGroupId.value = seed.merge_group_id || ''
  currentMergeSnapshotJson.value = seed.merge_snapshot_json || ''
  currentWarehouseName.value = seed.warehouse_name || '主仓库'
  form.rounding_adjustment = Number(seed.rounding_adjustment || 0)
  form.rounding_enabled = Math.abs(Number(seed.rounding_adjustment || 0)) > 0.0001
  dateValue.value = seed.received_at || ''
  lines.value = rows.map((item) => createLine(item))
  originalLineIds.value = rows.map((item) => Number(item.id)).filter(Boolean)
  auditImages.value = getDocumentReviewImages({ member_rows: rows })
  visible.value = true
}

function openCreate() {
  resetForm()
  viewMode.value = false
  promptRestoreTempDraft()
}

function openEdit(record) {
  if (record.document_status === 'approved') {
    message.error('已审核单据不能直接修改，请通过详情查看')
    return
  }
  resetForm()
  viewMode.value = false
  isEditMode.value = true
  const rows = getDocumentRows(record)
  const seed = rows[0] || record
  form.supplier = seed.supplier || ''
  form.purchase_order_no = seed.purchase_order_no || ''
  form.document_status = seed.document_status || 'draft'
  form.remark = buildPurchaseOrderRemark(rows)
  currentMergeGroupId.value = seed.merge_group_id || ''
  currentMergeSnapshotJson.value = seed.merge_snapshot_json || ''
  currentWarehouseName.value = seed.warehouse_name || '主仓库'
  form.rounding_adjustment = Number(seed.rounding_adjustment || 0)
  form.rounding_enabled = Math.abs(Number(seed.rounding_adjustment || 0)) > 0.0001
  dateValue.value = seed.received_at || ''
  lines.value = rows.map((item) => createLine(item))
  originalLineIds.value = rows.map((item) => Number(item.id)).filter(Boolean)
  promptRestoreTempDraft()
}

async function openCopy(record) {
  resetForm()
  viewMode.value = false
  isEditMode.value = false
  const rows = getDocumentRows(record)
  const seed = rows[0] || record
  form.supplier = seed.supplier || ''
  form.purchase_order_no = await api.db.getNextPurchaseOrderNo()
  form.document_status = 'draft'
  form.remark = buildPurchaseOrderRemark(rows)
  currentMergeGroupId.value = ''
  currentMergeSnapshotJson.value = ''
  currentWarehouseName.value = seed.warehouse_name || '主仓库'
  form.rounding_adjustment = 0
  form.rounding_enabled = false
  dateValue.value = ''
  lines.value = rows.map((item) =>
    createLine({
      ...item,
      id: null,
      batch_no: '',
      purchase_order_no: '',
      document_status: 'draft',
      received_at: '',
      review_images_json: '[]'
    })
  )
  originalLineIds.value = []
  auditImages.value = []
  message.success('已带出采购单内容，可直接另存为新采购单')
}

function openSplit(record) {
  splitForm.source_batch_id = record.id
  splitForm.source_batch_no = record.batch_no
  splitForm.batch_no = ''
  splitForm.split_qty = Number(record.remaining_qty || 0)
  splitForm.color = record.color || ''
  splitForm.processing_cost = 0
  splitForm.remark = ''
  splitVisible.value = true
}

async function save() {
  let validLines
  try {
    validLines = validatePurchaseLines(lines.value)
  } catch (error) {
    return message.error(error.message || '请检查采购明细后再保存')
  }

  const mismatchLines = getSupplierMismatchLines(validLines)
  if (mismatchLines.length) {
    const shouldRemove = await confirmSupplierMismatchRemoval(mismatchLines)
    if (!shouldRemove) return
    lines.value = lines.value.filter((line) => !mismatchLines.includes(line))
    try {
      validLines = validatePurchaseLines(lines.value)
    } catch (error) {
      return message.error(error.message || '删除不匹配原料后，采购单里已没有可保存的明细')
    }
  }

  try {
    const sharedPurchaseOrderNo = String(form.purchase_order_no || '').trim() || await api.db.getNextPurchaseOrderNo()
    const documentRoundingAdjustment = getDocumentRoundingAdjustment(validLines)
    const currentLineIds = validLines.map((item) => Number(item.id)).filter(Boolean)
    const deletedLineIds = isEditMode.value
      ? originalLineIds.value.filter((id) => !currentLineIds.includes(id))
      : []

    for (const line of validLines) {
      const batchNo = line.id ? line.batch_no : await api.db.getNextBatchNo()
      const mergeSnapshotJson = line.merge_snapshot_json || currentMergeSnapshotJson.value || ''
      await api.db.savePurchaseBatch({
        id: line.id,
        batch_no: batchNo,
        document_status: form.document_status,
        purchase_order_no: sharedPurchaseOrderNo,
        supplier: form.supplier,
        warehouse_name: line.warehouse_name || currentWarehouseName.value || '主仓库',
        merge_group_id: line.merge_group_id || currentMergeGroupId.value || '',
        merge_snapshot_json: mergeSnapshotJson,
        rounding_adjustment: line === validLines[0] ? documentRoundingAdjustment : 0,
        material_id: line.material_id,
        color: line.color,
        color_remark: line.color_remark,
        size: line.size || '',
        roll_count: Number(line.roll_count || 0),
        purchase_input_qty: Number(line.purchase_input_qty || 0),
        purchase_input_unit: line.purchase_input_unit,
        price_type: line.price_type,
        price_unit: line.price_unit,
        price: normalizePurchaseUnitPrice(line.price),
        processing_cost: Number(line.processing_cost || 0),
        processing_note: line.processing_note,
        received_at: dateValue.value || '',
        remark: form.remark
      })
    }
    for (const id of deletedLineIds) {
      await api.db.deletePurchaseBatch(id)
    }
    form.purchase_order_no = sharedPurchaseOrderNo
    form.rounding_adjustment = documentRoundingAdjustment
    message.success(isEditMode.value ? '采购批次已更新' : '采购批次已保存')
    clearTempDraft()
    visible.value = false
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '保存采购批次失败')
  }
}

async function saveSplit() {
  try {
    await api.db.splitPurchaseBatch({
      source_batch_id: splitForm.source_batch_id,
      batch_no: splitForm.batch_no,
      split_qty: splitForm.split_qty,
      color: splitForm.color,
      processing_cost: splitForm.processing_cost,
      remark: splitForm.remark
    })
    message.success('采购批次已拆分')
    splitVisible.value = false
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '拆分采购批次失败')
  }
}

async function remove(recordOrId) {
  const ids = typeof recordOrId === 'object' ? getRecordIds(recordOrId) : [Number(recordOrId)].filter(Boolean)
  try {
    for (const id of ids) {
      await api.db.deletePurchaseBatch(id)
    }
    message.success(ids.length > 1 ? '采购单已删除' : '采购批次已删除')
    scheduleListReload()
  } catch (error) {
    message.error(error.message || '删除采购批次失败')
  }
}

function handleBatchDelete() {
  const ids = expandSelectedIds(selectedRowKeys.value)
  if (!ids.length) return
  Modal.confirm({
    title: '确认批量删除采购单？',
    content: `本次将删除 ${selectedRowKeys.value.length} 张已勾选采购单及其明细，此操作不可恢复。`,
    okText: '确认删除',
    cancelText: '取消',
    onOk: () => remove(ids)
  })
}

async function exportPurchasePdf(record) {
  try { await api.order.exportPurchasePdf({ id: record.id, options: buildExportOptionsPayload() }) } catch (error) { message.error(error.message || '导出 PDF 失败') }
}
async function exportPurchaseExcel(record) {
  try { await api.order.exportPurchaseExcel({ id: record.id, options: buildExportOptionsPayload() }) } catch (error) { message.error(error.message || '导出 Excel 失败') }
}
async function exportPurchaseImage(record) {
  try { await api.order.exportPurchaseImage({ id: record.id, options: buildExportOptionsPayload() }) } catch (error) { message.error(error.message || '导出图片失败') }
}

async function exportMergedPurchasePdf(ids) {
  try { await api.order.exportMergedPurchasePdf(ids) } catch (error) { message.error(error.message || '合并导出 PDF 失败') }
}
async function exportMergedPurchaseExcel(ids) {
  try { await api.order.exportMergedPurchaseExcel(ids) } catch (error) { message.error(error.message || '合并导出 Excel 失败') }
}
async function exportMergedPurchaseImage(ids) {
  try { await api.order.exportMergedPurchaseImage(ids) } catch (error) { message.error(error.message || '合并导出图片失败') }
}

async function batchExportPurchaseDocuments(ids, format) {
  try {
    if (typeof api?.order?.batchExportPurchaseDocuments !== 'function') {
      throw new Error('当前测试版未加载到最新批量导出接口，请先关闭程序后重新通过桌面 BAT 启动最新版')
    }
    const payload = {
      ids: [...new Set((ids || []).map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0))],
      format: String(format || 'pdf').toLowerCase(),
      options: { ...buildExportOptionsPayload() }
    }
    if (!payload.ids.length) {
      throw new Error('请先勾选需要批量导出的采购单')
    }
    const result = await api.order.batchExportPurchaseDocuments(payload)
    if (result?.count) message.success(`已批量导出 ${result.count} 张采购单`)
  } catch (error) {
    message.error(error.message || '批量导出采购单失败')
  }
}

function openExportConfig(record, format, ids = []) {
  if (!loadStoredExportConfig()) {
    resetExportConfig()
  }
  exportTargetRecord.value = record || null
  exportTargetIds.value = Array.isArray(ids) ? [...ids] : []
  exportTargetFormat.value = format
  exportConfigVisible.value = true
}

async function confirmExportWithConfig() {
  const format = exportTargetFormat.value
  const record = exportTargetRecord.value
  const ids = exportTargetIds.value
  saveStoredExportConfig()
  exportConfigVisible.value = false
  if (record) {
    if (format === 'pdf') return exportPurchasePdf(record)
    if (format === 'excel') return exportPurchaseExcel(record)
    if (format === 'image') return exportPurchaseImage(record)
    return
  }
  if (ids.length && (format === 'pdf' || format === 'excel' || format === 'image')) {
    await batchExportPurchaseDocuments(ids, format)
  }
}

function handleExport(record, key) {
  if (key === 'pdf' || key === 'excel' || key === 'image') {
    openExportConfig(record, key)
  }
}

function handleBatchExport(key) {
  const ids = expandSelectedIds(selectedRowKeys.value)
  if (!ids.length) return
  if (key === 'pdf' || key === 'excel' || key === 'image') {
    openExportConfig(null, key, ids)
  }
}

function formatQty(value) {
  return Number(value || 0).toFixed(4).replace(/\.?0+$/, '') || '0'
}

watch([filterField, keyword, supplierFilter, materialCategoryFilter, documentStatusFilter, dateRange], () => {
  purchaseCurrentPage.value = 1
  scheduleListReload(80)
})

watch(
  () => route.query,
  (query) => {
    applyRouteQueryFilters(query)
    purchaseCurrentPage.value = 1
  },
  { deep: true }
)

watch([filterField, keywordInput, supplierFilter, materialCategoryFilter, documentStatusFilter, dateRange, sortField, sortOrder, purchaseCurrentPage, purchasePageSize], () => {
  saveStoredViewState()
}, { deep: true })

watch([filteredList, purchasePageSize], () => {
  const maxPage = Math.max(1, Math.ceil(filteredList.value.length / Math.max(Number(purchasePageSize.value || 12), 1)))
  if (purchaseCurrentPage.value > maxPage) purchaseCurrentPage.value = maxPage
})

watch(
  visibleColumnKeys,
  (keys) => {
    try {
      localStorage.setItem(purchaseColumnStorageKey, JSON.stringify(keys))
    } catch {
      // ignore local storage errors
    }
  },
  { deep: true }
)

onMounted(async () => {
  loadStoredViewState()
  await Promise.all([loadBaseData(), loadList()])
})

onActivated(async () => {
  await Promise.all([loadBaseData(true), loadList()])
})
</script>

<style scoped>
.erp-page :deep(.content-card) {
  border-radius: 28px;
  box-shadow: 0 24px 48px rgba(10, 31, 68, 0.08);
}

.erp-page :deep(.ant-card-head) {
  min-height: 72px;
  padding: 0 26px;
}

.erp-page :deep(.ant-card-head-title) {
  font-size: 24px;
  font-weight: 800;
  color: #173255;
}

.erp-page :deep(.ant-card-body) {
  padding: 22px 24px 24px;
}

.erp-table-caption {
  margin: 14px 0 18px;
  padding: 12px 14px;
  border-radius: 16px;
  background: linear-gradient(180deg, #f8fbff 0%, #f3f7fd 100%);
  border: 1px solid #e5eefb;
  color: #6f84a3;
  font-size: 13px;
  line-height: 1.75;
}

.erp-page :deep(.mobile-filter-shell__desktop) {
  gap: 18px;
}

.erp-page :deep(.mobile-filter-shell__filters) {
  padding: 14px;
  border-radius: 22px;
  background: linear-gradient(180deg, #f9fbff 0%, #f4f8ff 100%);
  border: 1px solid #e6eefc;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.erp-page :deep(.mobile-filter-shell__filters > *) {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}

.purchase-toolbar-control {
  width: 148px;
}

.purchase-toolbar-control--narrow {
  width: 118px;
}

.purchase-toolbar-control--date {
  width: 148px;
}

.purchase-toolbar-control--keyword {
  width: 198px;
  height: 32px !important;
  min-height: 32px !important;
  display: flex;
  align-items: center;
}

.purchase-toolbar-keyword-input {
  width: 100%;
}

.purchase-toolbar-control--keyword :deep(.ant-input),
.purchase-toolbar-control--keyword :deep(.ant-input-affix-wrapper),
.purchase-toolbar-keyword-input.ant-input,
.purchase-toolbar-keyword-input.ant-input-affix-wrapper,
.purchase-toolbar-keyword-input :deep(.ant-input),
.purchase-toolbar-keyword-input :deep(.ant-input-affix-wrapper) {
  height: 32px !important;
  max-height: 32px !important;
  min-height: 32px !important;
  line-height: 32px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

.purchase-toolbar-keyword-input :deep(.ant-input) {
  line-height: 30px !important;
}

.erp-page :deep(.mobile-filter-shell__actions) {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.toolbar-refresh-btn {
  min-width: 88px;
}

.erp-page :deep(.page-summary-strip) {
  margin-bottom: 18px;
}

.erp-page :deep(.page-summary-strip__item) {
  min-height: 118px;
  border-radius: 24px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  border: 1px solid #e5eefb;
  box-shadow: 0 18px 38px rgba(14, 43, 86, 0.06);
}

.erp-page :deep(.erp-dense-table .ant-table-wrapper),
.erp-page :deep(.erp-dense-table .ant-table-container) {
  border-radius: 22px;
}

.erp-page :deep(.erp-dense-table .ant-table) {
  background: #fff;
  border-radius: 22px;
}

.erp-page :deep(.erp-dense-table .ant-table-thead > tr > th) {
  background: #f5f8fe;
  color: #35537b;
  font-size: 13px;
  font-weight: 700;
}

.erp-page :deep(.erp-dense-table .ant-table-tbody > tr > td) {
  vertical-align: top;
  padding-top: 14px;
  padding-bottom: 14px;
}

.erp-page :deep(.mobile-filter-shell__filters .ant-input),
.erp-page :deep(.mobile-filter-shell__filters .ant-input-affix-wrapper),
.erp-page :deep(.mobile-filter-shell__filters .ant-select-selector),
.erp-page :deep(.mobile-filter-shell__filters .ant-picker) {
  min-height: 32px !important;
  border-radius: 12px !important;
}

.erp-page :deep(.ant-card),
.erp-page :deep(.ant-card-body),
.erp-page :deep(.ant-modal-content),
.erp-page :deep(.ant-modal-body) {
  overflow: visible;
}

.erp-page :deep(.ant-space) {
  row-gap: 8px;
}

.plan-editor-row {
  margin-bottom: 6px;
}

.plan-editor-row--compact {
  padding-top: 2px;
}

.plan-editor-row :deep(.ant-select-selector),
.plan-editor-row :deep(.ant-input-number),
.plan-editor-row :deep(.ant-input),
.plan-editor-row :deep(.ant-input-affix-wrapper) {
  border-radius: 12px !important;
}

.plan-editor-row :deep(.ant-select),
.plan-editor-row :deep(.ant-select-auto-complete),
.plan-editor-row :deep(.ant-select-selector),
.plan-editor-row :deep(.ant-input-affix-wrapper),
.plan-editor-row :deep(.ant-input) {
  width: 100% !important;
}

.plan-editor-row :deep(.plan-autocomplete .ant-input),
.plan-editor-row :deep(.plan-autocomplete .ant-input-affix-wrapper),
.plan-editor-row :deep(.plan-autocomplete .ant-select-selector) {
  min-height: 34px !important;
  height: 34px !important;
}

.plan-roll-count-col {
  flex: 0 0 84px !important;
  max-width: 84px !important;
  min-width: 84px !important;
}

.plan-roll-count-col :deep(.ant-form-item) {
  width: 84px !important;
}

.plan-roll-count-input,
.plan-roll-count-col :deep(.ant-input-number) {
  width: 84px !important;
  min-width: 84px !important;
  max-width: 84px !important;
}

.plan-roll-count-col :deep(.ant-input-number-input) {
  padding: 0 4px !important;
  text-align: center;
}

.plan-editor-row :deep(.ant-form-item) {
  margin-bottom: 8px;
}

.plan-editor-row :deep(.ant-form-item-label > label) {
  font-size: 12px;
  color: #6f84a3;
}

.bom-row {
  overflow: visible;
}

.bom-row-hint {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  padding-top: 4px;
}

.table-pagination--with-size {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding-top: 14px;
}

.table-pagination__size {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6f84a3;
  font-size: 12px;
}

.table-pagination__native-select {
  min-width: 74px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid #d6e0ef;
  border-radius: 12px;
  background: #fff;
  color: #173255;
  font-size: 12px;
}

.table-stack--tight {
  gap: 4px;
}

.table-primary {
  color: #183454;
  font-weight: 700;
  line-height: 1.6;
}

.table-secondary {
  color: #7590b5;
  font-size: 12px;
  line-height: 1.65;
}

.erp-mobile-list {
  display: grid;
  gap: 14px;
}

.erp-mobile-card {
  padding: 16px;
  border-radius: 22px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
  border: 1px solid #e6eefb;
  box-shadow: 0 14px 30px rgba(14, 43, 86, 0.08);
}

.erp-mobile-card--voided {
  opacity: 0.68;
  filter: grayscale(0.12);
}

.erp-mobile-card__head,
.erp-mobile-card__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
}

.erp-mobile-card__title {
  color: #183454;
  font-size: 16px;
  font-weight: 800;
}

.erp-mobile-card__meta,
.erp-mobile-card__sub,
.erp-mobile-card__label {
  color: #6e86a7;
  font-size: 12px;
  line-height: 1.65;
}

.erp-mobile-card__section {
  margin-top: 12px;
}

.erp-mobile-card__value {
  color: #173255;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}

.erp-mobile-card__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.erp-mobile-card__stat {
  padding: 10px 12px;
  border-radius: 16px;
  background: #f5f8fe;
}

@media (max-width: 900px) {
  .erp-page :deep(.ant-card-head) {
    min-height: 60px;
    padding: 0 18px;
  }

  .erp-page :deep(.ant-card-body) {
    padding: 18px 16px 18px;
  }

  .erp-page :deep(.mobile-filter-shell__filters) {
    padding: 0;
    background: transparent;
    border: 0;
    box-shadow: none;
  }

  .erp-mobile-card__grid {
    grid-template-columns: 1fr;
  }
}
</style>




